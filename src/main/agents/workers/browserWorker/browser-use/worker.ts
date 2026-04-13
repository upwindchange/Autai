import {
  streamText,
  createUIMessageStream,
  UIMessageChunk,
  ModelMessage,
  type UIMessage,
} from "ai";
import { chatModel } from "@agents/providers";
import { settingsService, HitlService } from "@/services";
import { flushTelemetry } from "@/agents/utils/telemetry";
import log from "electron-log/main";
import { observe } from "@langfuse/tracing";
import { browserUsePlanner, type UIPlanType } from "./planner";
import { browserUseTaskExecutor } from "./task-executor";
import {
  mergeStreamAndWait,
  writeSimulatedToolCallToStream,
} from "@agents/utils";

const logger = log.scope("Browser Use Worker");

const systemPrompt = `You are a browser automation assistant. Summarize what was accomplished and provide any relevant next steps or recommendations.`;

export async function browserUseWorker(
  messages: ModelMessage[],
  sessionId: string,
  originalMessages: UIMessage[],
  onFinish?: (messages: UIMessage[]) => void,
): Promise<ReadableStream<UIMessageChunk>> {
  logger.info("Entering Browser Use worker");

  const wrapped = observe(
    async () => {
      return createUIMessageStream({
        originalMessages,
        onFinish:
          onFinish ?
            ({ messages: finalMessages }) => onFinish(finalMessages)
          : undefined,
        execute: async ({ writer }) => {
          try {
            // ============================================================
            // Stage 1: Planning
            // ============================================================
            logger.debug("Stage 1: Generating high-level plan");
            const planResult = await browserUsePlanner(messages, sessionId);

            // Wait for plan to complete (programmatic access only, not streamed)
            const steps = await planResult.steps;
            const planToolCallId = steps
              .flatMap((s) => s.toolCalls ?? [])
              .find((tc) => tc.toolName === "plan")!.toolCallId;
            const planToolResult = steps
              .flatMap((s) => s.toolResults ?? [])
              .find((tr) => tr.toolName === "plan");
            const plan = planToolResult?.output as UIPlanType;

            if (!plan) {
              logger.error("Failed to generate plan: tool not called");
              throw new Error(
                "Failed to generate plan: plan tool not called",
              );
            }

            logger.info("Plan generated successfully", {
              taskCount: plan.todos.length,
            });

            // ============================================================
            // Approval Point 1: Wait for user to approve the plan
            // ============================================================
            plan.requiresApproval = true;
            writeSimulatedToolCallToStream({
              writer,
              toolCallId: planToolCallId,
              toolName: "plan",
              input: plan,
              output: plan,
            });

            logger.info("Waiting for plan approval", { planId: plan.id });
            const approvalDecision =
              await HitlService.getInstance().request<"approved" | "rejected">(plan.id);

            if (approvalDecision === "rejected") {
              logger.info("Plan rejected by user", { planId: plan.id });
              // Mark all todos as cancelled
              for (const todo of plan.todos) {
                todo.status = "cancelled";
              }
              plan.requiresApproval = false;
              writeSimulatedToolCallToStream({
                writer,
                toolCallId: planToolCallId,
                toolName: "plan",
                input: plan,
                output: plan,
              });
              return;
            }

            logger.info("Plan approved by user", { planId: plan.id });
            plan.requiresApproval = false;
            writeSimulatedToolCallToStream({
              writer,
              toolCallId: planToolCallId,
              toolName: "plan",
              input: plan,
              output: plan,
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
                planToolCallId,
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
            await flushTelemetry();
          }
        },
        onError: (error) => {
          logger.error("Error in browser use worker", {
            error,
            stack: error instanceof Error ? error.stack : undefined,
          });
          return error instanceof Error ? error.message : String(error);
        },
      });
    },
    { name: "browser-use-worker", endOnExit: false },
  );

  return wrapped() as Promise<ReadableStream<UIMessageChunk>>;
}
