import {
  streamText,
  createUIMessageStream,
  UIMessageChunk,
  ModelMessage,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { settingsService, HitlService } from "@/services";
import { i18n } from "@/i18n";
import { sendAlert } from "@/utils/messageUtils";
import { flushTelemetry } from "@/agents/utils/telemetry";
import log from "electron-log/main";
import { observe } from "@langfuse/tracing";
import {
  browserUsePlanner,
  browserUseReplanner,
  type UIPlanType,
} from "./planner";
import { executeSubtasks, type ExecutionOutcome } from "./action-executor";
import { executeSimpleBrowserTask } from "./simple-executor";
import {
  mergeStreamAndWait,
  writeSimulatedToolCallToStream,
  retryStreamTextForTool,
  TIMEOUTS,
  isAbortError,
  isTimeoutError,
} from "@agents/utils";

const logger = log.scope("Browser Use Worker");

const systemPrompt = `You are a browser automation assistant. Summarize what was accomplished and provide any relevant next steps or recommendations.

For inline math expressions, use double dollar signs like $$E = mc^2$$. Never use single dollar signs for math.`;

export async function browserUseWorker(
  messages: ModelMessage[],
  sessionId: string,
  originalMessages: UIMessage[],
  chatLanguageModel: LanguageModel,
  onFinish?: (messages: UIMessage[]) => void,
  options?: { planned?: boolean },
  signal?: AbortSignal,
): Promise<ReadableStream<UIMessageChunk>> {
  logger.info("Entering Browser Use worker", { planned: options?.planned });

  // Simple mode: direct execution, no planner
  if (!options?.planned) {
    const simpleStream = await executeSimpleBrowserTask(
      messages,
      sessionId,
      chatLanguageModel,
      signal,
    );
    return createUIMessageStream({
      originalMessages,
      onFinish:
        onFinish ?
          ({ messages: finalMessages }) => onFinish(finalMessages)
        : undefined,
      execute: async ({ writer }) => {
        await mergeStreamAndWait(simpleStream, writer);
      },
      onError: (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error("Error in simple browser use worker", { error });
        return msg;
      },
    });
  }

  // Planned mode: planner → approval → action-executor → replanner → summary
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
            const maxRetries = settingsService.settings.maxRetries;

            const planRetryResult = await retryStreamTextForTool(
              () => browserUsePlanner(messages, sessionId, signal),
              "plan",
              (output) => output as UIPlanType,
              { maxAttempts: maxRetries, logger },
            );

            if (!planRetryResult) {
              logger.error("Failed to generate plan after retries");
              throw new Error(
                "Failed to generate plan: plan tool not called after retries",
              );
            }

            const plan = planRetryResult;
            const planToolCallId = plan.id;

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
            const abortOnCancel =
              signal ?
                new Promise<never>((_, reject) => {
                  signal.addEventListener(
                    "abort",
                    () => reject(new DOMException("Aborted", "AbortError")),
                    { once: true },
                  );
                })
              : null;
            const approvalDecision = await (abortOnCancel ?
              Promise.race([
                HitlService.getInstance().request<"approved" | "rejected">(
                  plan.id,
                  undefined,
                  signal,
                ),
                abortOnCancel,
              ])
            : HitlService.getInstance().request<"approved" | "rejected">(
                plan.id,
              ));

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
            // Stage 2: Execute plan + replan on failure or executor request
            // ============================================================
            // Extract the last user message for executor context
            const lastUserMessage = messages
              .filter((m) => m.role === "user")
              .pop();
            if (!lastUserMessage) {
              throw new Error("No user message found for planned execution");
            }
            const userRequest: string =
              typeof lastUserMessage.content === "string" ?
                lastUserMessage.content
              : lastUserMessage.content
                  .filter(
                    (p): p is { type: "text"; text: string } =>
                      p.type === "text",
                  )
                  .map((p) => p.text)
                  .join("\n");

            let currentPlan = plan;
            let currentPlanToolCallId = planToolCallId;
            let attemptCount = 0;

            while (attemptCount <= maxRetries) {
              // Abort guard: stop if request was cancelled
              if (signal?.aborted) {
                logger.info("Plan execution aborted", { attemptCount });
                break;
              }

              logger.debug("Executing plan", {
                attemptCount,
                taskCount: currentPlan.todos.length,
              });

              const outcome: ExecutionOutcome = {};
              const actionExecutorStream = await executeSubtasks(
                currentPlan,
                sessionId,
                currentPlanToolCallId,
                outcome,
                userRequest,
                chatLanguageModel,
                signal,
              );
              await mergeStreamAndWait(actionExecutorStream, writer);

              // Check for replan request from executor and/or failed todos
              const replanRequest = outcome.replanRequest;
              const failedTodoIndex = currentPlan.todos.findIndex(
                (t) => t.status === "cancelled",
              );

              if (failedTodoIndex === -1 && !replanRequest) {
                logger.info("All tasks completed successfully");
                break;
              }

              if (attemptCount >= maxRetries) {
                // Max retries exceeded, mark remaining pending todos as cancelled
                logger.error("Max retries exceeded", {
                  failedTodoIndex,
                  replanRequest: !!replanRequest,
                  attemptCount,
                });
                const startIndex =
                  failedTodoIndex >= 0 ? failedTodoIndex + 1 : 0;
                for (let i = startIndex; i < currentPlan.todos.length; i++) {
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

              // Determine replan context
              attemptCount++;
              let replanFromIndex: number;
              let replanReason: string;

              if (replanRequest) {
                // Executor requested replan with detailed reason
                const requestingIndex = currentPlan.todos.findIndex(
                  (t) => t.id === replanRequest.requestingTaskId,
                );
                replanFromIndex =
                  replanRequest.fromPosition === "current" ?
                    requestingIndex
                  : requestingIndex + 1;
                replanReason = replanRequest.reason;
                logger.info("Replanning per executor request", {
                  reason: replanReason,
                  fromPosition: replanRequest.fromPosition,
                  replanFromIndex,
                  attemptCount,
                });
              } else {
                // Traditional failure-triggered replan
                replanFromIndex = failedTodoIndex;
                replanReason = `Task failed: ${currentPlan.todos[failedTodoIndex].label}`;
                logger.info("Replanning after task failure", {
                  failedTodoIndex,
                  attemptCount,
                  maxRetries,
                });
              }

              const replanResult = await retryStreamTextForTool(
                () =>
                  browserUseReplanner(
                    sessionId,
                    currentPlan,
                    replanFromIndex,
                    replanReason,
                    signal,
                  ),
                "plan",
                (output) => output as UIPlanType,
                { maxAttempts: maxRetries, logger },
              );

              if (!replanResult) {
                logger.error("Replanning failed after retries");
                throw new Error(
                  "Replanning failed: plan tool not called after retries",
                );
              }

              const newPlan = replanResult;
              const newPlanToolCallId = newPlan.id;

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
              model: chatLanguageModel,
              messages,
              system: systemPrompt,
              maxRetries,
              timeout: TIMEOUTS.chat,
              abortSignal: signal,
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
          if (isAbortError(error)) {
            logger.info("Browser use worker cancelled by user");
            return "";
          }
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
