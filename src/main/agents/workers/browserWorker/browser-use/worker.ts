import {
  streamText,
  createUIMessageStream,
  UIMessageChunk,
  ModelMessage,
  type UIMessage,
} from "ai";
import { chatModel } from "@agents/providers";
import { settingsService } from "@/services";
import { trace, context } from "@opentelemetry/api";
import log from "electron-log/main";
import { browserUsePlanner, type UIPlanType } from "./planner";
import { browserUseTaskExecutor } from "./task-executor";
import { mergeStreamAndWait } from "@agents/utils";

const logger = log.scope("Browser Use Worker");

const systemPrompt = `You are a browser automation assistant. Summarize what was accomplished and provide any relevant next steps or recommendations.`;

export async function browserUseWorker(
  messages: ModelMessage[],
  sessionId: string,
  originalMessages: UIMessage[],
  onFinish?: (messages: UIMessage[]) => void,
): Promise<ReadableStream<UIMessageChunk>> {
  logger.info("Entering Browser Use worker");

  return createUIMessageStream({
    originalMessages,
    onFinish: onFinish
      ? ({ messages: finalMessages }) => onFinish(finalMessages)
      : undefined,
    execute: async ({ writer }) => {
      // Create a root span so all child streamText calls nest under one Langfuse trace
      const tracer = trace.getTracer("browser-use-worker", "1.0.0");
      const rootSpan = tracer.startSpan("browser-use-worker");
      rootSpan.setAttribute("session.id", sessionId);

      return context.with(
        trace.setSpan(context.active(), rootSpan),
        async () => {
          try {
            // ============================================================
            // Stage 1: Planning
            // ============================================================
            logger.debug("Stage 1: Generating high-level plan");
            const planResult = await browserUsePlanner(messages, sessionId);

            // Merge planning stream and wait for completion
            await mergeStreamAndWait(
              planResult.toUIMessageStream({ sendStart: false }),
              writer,
            );

            // Extract plan from tool result
            const steps = await planResult.steps;
            const planToolResult = steps
              .flatMap((s) => s.toolResults ?? [])
              .find((tr) => tr.toolName === "showPlan");
            const plan = planToolResult?.output as UIPlanType;

            if (!plan) {
              logger.error("Failed to generate plan: tool not called");
              throw new Error(
                "Failed to generate plan: showPlan tool not called",
              );
            }

            logger.info("Plan generated successfully", {
              taskCount: plan.todos.length,
            });

            // ============================================================
            // Stage 2-3: Task execution loop
            // ============================================================
            let currentTaskIndex = 0;

            while (currentTaskIndex < plan.todos.length) {
              logger.debug("Processing task", {
                currentTaskIndex,
                totalTasks: plan.todos.length,
              });

              // Execute task (including subtask planning and execution)
              const taskExecutorStream = await browserUseTaskExecutor(
                messages,
                sessionId,
                plan,
                currentTaskIndex,
              );

              // Merge task execution stream and wait for completion
              await mergeStreamAndWait(taskExecutorStream, writer);

              // Check if task completed successfully
              if (plan.todos[currentTaskIndex].status === "completed") {
                logger.info("Task completed, moving to next", {
                  completedIndex: currentTaskIndex,
                });

                // Move to next task
                currentTaskIndex += 1;
              } else {
                // Task failed (status will be "cancelled" after max retries)
                logger.error("Task failed after multiple attempts", {
                  currentTaskIndex,
                  taskStatus: plan.todos[currentTaskIndex].status,
                });
                // Break out of the loop since task failed permanently
                break;
              }
            }

            // ============================================================
            // Stage 4: Final summary
            // ============================================================
            logger.debug("Stage 4: Generating final summary");
            const summaryResult = streamText({
              model: chatModel(),
              messages,
              system: systemPrompt,
              experimental_telemetry: {
                isEnabled: settingsService.settings.langfuse.enabled,
                functionId: "browser-use-summary",
              },
            });

            // Merge summary stream and wait for completion
            await mergeStreamAndWait(
              summaryResult.toUIMessageStream({ sendStart: false }),
              writer,
            );

            logger.info("Browser use workflow completed successfully");
          } finally {
            rootSpan.end();
          }
        },
      );
    },
    onError: (error) => {
      logger.error("Error in browser use worker", {
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return error instanceof Error ? error.message : String(error);
    },
  });
}
