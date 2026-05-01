import { streamText, tool, stepCountIs, ModelMessage, generateId } from "ai";
import { z } from "zod";
import { complexModel } from "@agents/providers";
import { settingsService, SessionTabService } from "@/services";
import { hasSuccessfulToolResult } from "@/agents/utils";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import log from "electron-log/main";
import type { UIPlanType, UIPlanTodo } from "./planner";

const logger = log.scope("browser-use-recovery");

// ============================================================================
// Types
// ============================================================================

export type RecoveryLevel = "task_executor" | "planner" | "abort";

export interface RecoveryDecision {
  level: RecoveryLevel;
  recoveryInstruction: string;
  reason: string;
}

export interface RecoveryContext {
  failedSubtask: UIPlanTodo;
  failedSubtaskIndex: number;
  subtaskPlan: UIPlanType;
  currentTask: UIPlanTodo;
  currentTaskIndex: number;
  plan: UIPlanType;
  messages: ModelMessage[];
  sessionId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actionExecutorSteps: any[];
}

// ============================================================================
// Tool Definition
// ============================================================================

const recoveryDecisionTool = tool({
  description:
    "Provide the recovery decision for a failed subtask. Analyze the failure context and decide the best recovery strategy.",
  inputSchema: z.object({
    level: z
      .enum(["task_executor", "planner", "abort"])
      .describe(
        'Recovery level: "task_executor" to replan only the current task subtasks, "planner" to replan the entire high-level plan, "abort" to stop execution entirely',
      ),
    recoveryInstruction: z
      .string()
      .min(10)
      .describe(
        "Detailed instruction (2-4 sentences) for the replanning agent about what went wrong and what to do differently",
      ),
    reason: z
      .string()
      .min(5)
      .describe("Brief one-sentence explanation of why this recovery level was chosen"),
  }),
  execute: async ({ level, recoveryInstruction, reason }) => ({
    level,
    recoveryInstruction,
    reason,
  }),
});

// ============================================================================
// System Prompt
// ============================================================================

const RECOVERY_SYSTEM_PROMPT = `You are a browser automation recovery analyst. A subtask has failed during execution.
Your job is to analyze the failure context and decide the best recovery strategy.

## Your Decision

Choose ONE of these recovery levels:

### "task_executor" — Replan only the subtasks for the current task
Choose this when:
- The failure is local to the current task's subtask breakdown
- A different subtask decomposition might succeed
- The high-level plan is still valid
- Example: "Fill login form" failed because the form structure was different than expected

### "planner" — Replan the entire high-level plan
Choose this when:
- The failure reveals the overall plan is flawed
- The approach at the high level needs to change
- Previous completed tasks may have changed the situation
- External factors (page redirects, site changes) invalidate the plan structure
- Example: "Navigate to settings page" failed because the site requires a different flow

### "abort" — Stop execution entirely
Choose this when:
- The failure is fundamental and cannot be recovered from
- The target website is unreachable or broken
- The user's request is impossible to fulfill

Be decisive. Do not suggest retrying the same approach.`;

// ============================================================================
// Main Exported Function
// ============================================================================

export async function recoveryAgent(
  context: RecoveryContext,
): Promise<RecoveryDecision> {
  const {
    failedSubtask,
    subtaskPlan,
    currentTask,
    plan,
    actionExecutorSteps,
  } = context;

  const sessionTabService = SessionTabService.getInstance();
  const activeTabId = sessionTabService.getActiveTabForSession(context.sessionId);

  let currentDOM = "No active tab available — cannot retrieve DOM.";
  if (activeTabId) {
    try {
      const domResult = await getFlattenDOMTool.execute!(
        {},
        {
          toolCallId: generateId(),
          messages: [],
          experimental_context: { sessionId: context.sessionId, activeTabId },
        },
      );
      currentDOM = (domResult as { representation: string }).representation;
    } catch (error) {
      logger.warn("Failed to get flatten DOM for recovery analysis", {
        error: error instanceof Error ? error.message : String(error),
      });
      currentDOM = `Failed to retrieve DOM: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const prompt = `## Failed Subtask
${JSON.stringify(failedSubtask, null, 2)}

## Action Executor Steps (what happened before failure)
${JSON.stringify(actionExecutorSteps, null, 2)}

## Current Page DOM State
${currentDOM}

## Subtask Plan (all subtasks for current task)
${JSON.stringify(subtaskPlan, null, 2)}

## Current High-Level Task
${JSON.stringify(currentTask, null, 2)}

## Full Plan (all high-level tasks)
${JSON.stringify(plan, null, 2)}

Analyze the failure and decide the best recovery strategy.`;

  try {
    const result = streamText({
      model: complexModel(),
      prompt,
      system: RECOVERY_SYSTEM_PROMPT,
      tools: { recoveryDecision: recoveryDecisionTool },
      toolChoice: { type: "tool", toolName: "recoveryDecision" },
      stopWhen: [
        hasSuccessfulToolResult("recoveryDecision"),
        stepCountIs(5),
      ],
      experimental_telemetry: {
        isEnabled: settingsService.settings.langfuse.enabled,
        functionId: "browser-use-recovery",
      },
    });

    const steps = await result.steps;
    const decision = steps
      .flatMap((s) => s.toolResults ?? [])
      .find((r) => r.toolName === "recoveryDecision")?.output as
      | RecoveryDecision
      | undefined;

    if (!decision) {
      logger.error("Recovery agent did not produce a decision");
      return {
        level: "abort",
        recoveryInstruction:
          "Recovery agent failed to produce a decision. Stopping execution.",
        reason: "Recovery agent did not call the decision tool",
      };
    }

    logger.info("Recovery decision made", {
      level: decision.level,
      reason: decision.reason,
      failedSubtask: failedSubtask.label,
    });

    return decision;
  } catch (error) {
    logger.error("Recovery agent failed", {
      error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      level: "abort",
      recoveryInstruction:
        "Recovery analysis failed. Stopping execution.",
      reason: `Recovery agent error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
