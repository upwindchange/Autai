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

// ============================================================================
// Helper: Generate plan and wait for user approval
// ============================================================================

async function generateAndApprovePlan(
  messages: ModelMessage[],
  sessionId: string,
  writer: {
    write: (chunk: UIMessageChunk) => void;
  },
  recoveryInstruction?: string,
): Promise<{ plan: UIPlanType; planToolCallId: string } | null> {
  const planResult = await browserUsePlanner(
    messages,
    sessionId,
    recoveryInstruction,
  );

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

  // Request user approval
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
    return null;
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

  return { plan, planToolCallId };
}

// ============================================================================
// Main Exported Function
// ============================================================================

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
            // Stage 1: Planning + Approval
            // ============================================================
            logger.debug("Stage 1: Generating high-level plan");

            const planResult = await generateAndApprovePlan(
              messages,
              sessionId,
              writer,
            );

            if (!planResult) {
              return; // User rejected the plan
            }

            let { plan, planToolCallId } = planResult;

            // ============================================================
            // Stage 2-3: Task execution loop (with planner-level recovery)
            // ============================================================
            let currentTaskIndex = 0;
            let hasReplanned = false;

            while (currentTaskIndex < plan.todos.length) {
              logger.debug("Processing task", {
                currentTaskIndex,
                totalTasks: plan.todos.length,
              });

              const taskExecutorStream = await browserUseTaskExecutor(
                messages,
                sessionId,
                plan,
                currentTaskIndex,
                planToolCallId,
              );

              await mergeStreamAndWait(taskExecutorStream, writer);

              const task = plan.todos[currentTaskIndex];
              const receipt = task.receipt;

              if (task.status === "completed") {
                // Task succeeded, move to next
                logger.info("Task completed, moving to next", {
                  completedIndex: currentTaskIndex,
                });
                currentTaskIndex += 1;
              } else if (
                receipt?.outcome === "failed" &&
                receipt.identifiers?.recoveryInstruction &&
                !hasReplanned
              ) {
                // Planner-level recovery: replan the entire plan
                logger.info("Planner-level recovery triggered", {
                  currentTaskIndex,
                });

                hasReplanned = true;
                const replanResult = await generateAndApprovePlan(
                  messages,
                  sessionId,
                  writer,
                  receipt.identifiers.recoveryInstruction,
                );

                if (!replanResult) {
                  break; // User rejected the replan
                }

                plan = replanResult.plan;
                planToolCallId = replanResult.planToolCallId;
                currentTaskIndex = 0;
              } else {
                // Task cancelled (abort or recovery exhausted) — stop
                logger.error("Task failed, stopping execution", {
                  currentTaskIndex,
                  taskStatus: task.status,
                });
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
