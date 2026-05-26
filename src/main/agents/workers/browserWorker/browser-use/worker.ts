import {
  streamText,
  createUIMessageStream,
  UIMessageChunk,
  ModelMessage,
  type UIMessage,
} from "ai";
import { chatModel } from "@agents/providers";
import { settingsService, HitlService } from "@/services";
import { i18n } from "@/i18n";
import { sendAlert } from "@/utils/messageUtils";
import { flushTelemetry } from "@/agents/utils/telemetry";
import log from "electron-log/main";
import { observe } from "@langfuse/tracing";
import { browserUsePlanner, browserUseReplanner, type UIPlanType } from "./planner";
import { executeSubtasks } from "./action-executor";
import {
  mergeStreamAndWait,
  writeSimulatedToolCallToStream,
  TIMEOUTS,
  isTimeoutError,
} from "@agents/utils";

const logger = log.scope("Browser Use Worker");

const systemPrompt = `You are a browser automation assistant. Summarize what was accomplished and provide any relevant next steps or recommendations.

For inline math expressions, use double dollar signs like $$E = mc^2$$. Never use single dollar signs for math.`;

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
              throw new Error("Failed to generate plan: plan tool not called");
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
            const approvalDecision = await HitlService.getInstance().request<
              "approved" | "rejected"
            >(plan.id);

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
            // Stage 2: Execute plan + replan on failure
            // ============================================================
            let currentPlan = plan;
            let currentPlanToolCallId = planToolCallId;
            let attemptCount = 0;
            const maxRetries = 3;

            while (attemptCount <= maxRetries) {
              logger.debug("Executing plan", {
                attemptCount,
                taskCount: currentPlan.todos.length,
              });

              const actionExecutorStream = await executeSubtasks(
                currentPlan,
                sessionId,
                currentPlanToolCallId,
              );
              await mergeStreamAndWait(actionExecutorStream, writer);

              // Find first failed todo
              const failedTodoIndex = currentPlan.todos.findIndex(
                (t) => t.status === "cancelled",
              );

              if (failedTodoIndex === -1) {
                logger.info("All tasks completed successfully");
                break;
              }

              if (attemptCount >= maxRetries) {
                // Max retries exceeded, mark remaining pending todos as cancelled
                logger.error("Max retries exceeded after task failure", {
                  failedTodoIndex,
                  attemptCount,
                });
                for (
                  let i = failedTodoIndex + 1;
                  i < currentPlan.todos.length;
                  i++
                ) {
                  if (currentPlan.todos[i].status === "pending") {
                    currentPlan.todos[i].status = "cancelled";
                  }
                }
                writeSimulatedToolCallToStream({
                  writer,
                  toolCallId: currentPlanToolCallId,
                  toolName: "plan",
                  input: {
                    title: currentPlan.title,
                    description: currentPlan.description,
                    todos: currentPlan.todos,
                  },
                  output: currentPlan,
                });
                break;
              }

              // Replan remaining work
              attemptCount++;
              logger.info("Replanning after task failure", {
                failedTodoIndex,
                attemptCount,
                maxRetries,
              });

              const replanResult = await browserUseReplanner(
                sessionId,
                currentPlan,
                failedTodoIndex,
              );
              const replanSteps = await replanResult.steps;
              const newPlanToolCallId = replanSteps
                .flatMap((s) => s.toolCalls ?? [])
                .find((tc) => tc.toolName === "plan")!.toolCallId;
              const newPlan = replanSteps
                .flatMap((s) => s.toolResults ?? [])
                .find((tr) => tr.toolName === "plan")?.output as
                | UIPlanType
                | undefined;

              if (!newPlan) {
                logger.error("Replanning failed: plan tool not called");
                throw new Error(
                  "Replanning failed: plan tool not called",
                );
              }

              logger.info("Replan generated successfully", {
                title: newPlan.title,
                todoCount: newPlan.todos.length,
              });

              // Stream new plan to UI
              writeSimulatedToolCallToStream({
                writer,
                toolCallId: newPlanToolCallId,
                toolName: "plan",
                input: newPlan,
                output: newPlan,
              });

              currentPlan = newPlan;
              currentPlanToolCallId = newPlanToolCallId;
            }

            // ============================================================
            // Stage 3: Final summary
            // ============================================================
            logger.debug("Stage 4: Generating final summary");
            const summaryResult = streamText({
              model: chatModel(),
              messages,
              system: systemPrompt,
              timeout: TIMEOUTS.chat,
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
          const msg = error instanceof Error ? error.message : String(error);
          logger.error("Error in browser use worker", {
            error,
            stack: error instanceof Error ? error.stack : undefined,
          });
          if (isTimeoutError(error)) {
            sendAlert(
              i18n.t("agents.timeoutErrorTitle"),
              i18n.t("agents.timeoutErrorBody"),
            );
          } else {
            sendAlert(
              i18n.t("agents.browserUseErrorTitle"),
              i18n.t("agents.browserUseErrorBody", { error: msg }),
            );
          }
          return msg;
        },
      });
    },
    { name: "browser-use-worker", endOnExit: false },
  );

  return wrapped() as Promise<ReadableStream<UIMessageChunk>>;
}
