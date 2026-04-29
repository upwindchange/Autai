import {
  streamText,
  createUIMessageStream,
  ModelMessage,
  tool,
  stepCountIs,
} from "ai";
import { complexModel } from "@agents/providers";
import { settingsService } from "@/services";
import {
  mergeStreamAndWait,
  writeSimulatedToolCallToStream,
} from "@agents/utils";
import log from "electron-log/main";
import { planInputSchema } from "./planner";
import type { UIPlanType, UIPlanTodo } from "./planner";
import { executeSubtasks } from "./action-executor";
import { hasSuccessfulToolResult } from "@/agents/utils";
import { recoveryAgent, type RecoveryDecision } from "./recovery";

const logger = log.scope("browser-use-task-executor");

// ============================================================================
// Helper Functions
// ============================================================================

function buildSystemPrompt(
  currentTask: UIPlanTodo,
  taskPlan: UIPlanType,
  recoveryInstruction?: string,
): string {
  const baseInstructions = `

## Your Responsibilities
Expand the current task into subtasks that provide clear instructions for the next subagent.

## Example
If the current task is "Log in to current site", you might create:
1. "Locate and navigate to the login portal/page"
2. "Find the username and password input fields on the page"
3. "Fill in the username and password credentials. If username and password are on different pages, submit the first page and fill in credentials on each page separately"
4. "Submit all information and complete the login process"

## Plan Schema
The plan tool expects a plan object with these REQUIRED fields:
- title: Short title for the subtask plan (e.g., "Subtask plan: Navigate to Google.com")
- description: Brief description of the subtask plan's overall goal
- todos: Array of subtask items (see below)

## Subtask Schema
Each subtask has:
- label: Brief action title (e.g., "Navigate to login page and locate login form")
- status: Always "pending"
- description: Clear instructions on what this subtask should accomplish

## Subtask Guidelines
- Group related actions together
- Browser and tab are always available. Do NOT plan setup tasks like "open browser" or "ensure tab is ready"
- Write instructional descriptions that guide the action-executor agent
- Do NOT break into atomic actions (click, type). That is for the action-executor agent
- Consider page state from previous subtasks when writing instructions

## Important
You MUST call the plan tool to provide your subtask plan. Do not just describe the plan in text — you are required to use the plan tool.`;

  let recoverySection = "";
  if (recoveryInstruction) {
    recoverySection = `

## Recovery Instruction
A previous attempt to execute this task failed. Here is guidance for replanning:

${recoveryInstruction}

You MUST take this guidance into account when creating the new subtask plan.
Do NOT repeat the same approach that failed before.`;
  }

  return `You are a browser automation subtask planner. Break down one high-level task into instructional subtasks.

## Current Task
${JSON.stringify(currentTask, null, 2)}${recoverySection}

## Overall Plan Context
${JSON.stringify(taskPlan, null, 2)}${baseInstructions}`;
}

// ============================================================================
// Tool Definition
// ============================================================================

const generateSubtaskPlanTool = tool({
  description: "Generate a subtask execution plan for the current task",
  inputSchema: planInputSchema,
  execute: async (input, { experimental_context }) => {
    const context = experimental_context as { sessionId: string };
    const todosWithIds = input.todos.map((todo, index) => ({
      ...todo,
      id: `subtask-${context.sessionId}-${index}`,
    }));
    const subtaskPlan: UIPlanType = {
      ...input,
      id: `subtaskplan-${context.sessionId}`,
      maxVisibleTodos: 4,
      todos: todosWithIds,
    };
    return subtaskPlan;
  },
});

// ============================================================================
// Internal: Plan + Execute Subtasks (with optional recovery instruction)
// ============================================================================

async function planAndExecuteSubtasks(
  sessionId: string,
  plan: UIPlanType,
  currentTaskIndex: number,
  writer: Parameters<Parameters<typeof createUIMessageStream>[0]["execute"]>[0]["writer"],
  recoveryInstruction?: string,
): Promise<{ subtaskPlan: UIPlanType; failed: boolean }> {
  const currentTask = plan.todos[currentTaskIndex];
  const systemPrompt = buildSystemPrompt(
    currentTask,
    plan,
    recoveryInstruction,
  );

  // Step 1: Generate subtask plan
  const subtaskPlanResult = streamText({
    model: complexModel(),
    messages: [
      { role: "user", content: "Create the subtask plan for this task." },
    ],
    system: systemPrompt,
    toolChoice: {
      type: "tool",
      toolName: "plan",
    },
    tools: {
      plan: generateSubtaskPlanTool,
    },
    experimental_context: { sessionId },
    stopWhen: [hasSuccessfulToolResult("plan"), stepCountIs(100)],
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "browser-use-task-executor",
      metadata: {
        currentTaskIndex,
        currentTaskLabel: currentTask.label,
        isRecovery: !!recoveryInstruction,
      },
    },
  });

  const steps = await subtaskPlanResult.steps;
  const allToolResults = steps.flatMap((step) => step.toolResults ?? []);
  const subtaskPlanToolCallId = steps
    .flatMap((s) => s.toolCalls ?? [])
    .find((tc) => tc.toolName === "plan")!.toolCallId;
  const subtaskPlanResultData = allToolResults.find(
    (toolResult) =>
      toolResult.toolName === "plan" && toolResult.type === "tool-result",
  )?.output as UIPlanType | undefined;

  if (!subtaskPlanResultData) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyResults = allToolResults as any[];
    const errorResults = anyResults.filter(
      (tr) => tr.toolName === "plan" && tr.type === "tool-error",
    );
    if (errorResults.length > 0) {
      logger.error("plan tool call(s) failed with errors", {
        count: errorResults.length,
        errors: errorResults.map((er) => ({
          error: er.error,
          input: er.input,
        })),
      });
    } else {
      logger.error("No plan tool results found at all", {
        allToolResultNames: allToolResults.map(
          (tr) => `${tr.type}:${tr.toolName}`,
        ),
      });
    }
    throw new Error(
      "Failed to generate subtask plan: plan tool not called",
    );
  }

  logger.info("Subtask plan generated successfully", {
    title: subtaskPlanResultData.title,
    todoCount: subtaskPlanResultData.todos.length,
  });

  // Stream the plan to the frontend
  writeSimulatedToolCallToStream({
    writer,
    toolCallId: subtaskPlanToolCallId,
    toolName: "plan",
    input: subtaskPlanResultData,
    output: subtaskPlanResultData,
  });

  // Step 2: Execute subtasks
  logger.debug("Starting subtask execution", {
    subtaskCount: subtaskPlanResultData.todos.length,
  });

  const actionExecutorStream = await executeSubtasks(
    subtaskPlanResultData,
    sessionId,
    subtaskPlanToolCallId,
  );

  await mergeStreamAndWait(actionExecutorStream, writer);

  const failed = subtaskPlanResultData.todos.some(
    (t) => t.status === "cancelled",
  );

  return { subtaskPlan: subtaskPlanResultData, failed };
}

// ============================================================================
// Main Exported Function
// ============================================================================

/**
 * Browser Use Task Executor
 *
 * Expands a high-level task into subtasks and executes them.
 * On failure, calls the recovery agent to decide recovery strategy.
 *
 * Planner-level recovery is signaled via plan.todos[currentTaskIndex].receipt:
 *   - outcome "failed" with identifiers.recoveryInstruction → worker.ts replans
 *   - outcome "cancelled" → worker.ts stops
 */
export async function browserUseTaskExecutor(
  messages: ModelMessage[],
  sessionId: string,
  plan: UIPlanType,
  currentTaskIndex: number,
  planToolCallId: string,
): Promise<ReturnType<typeof createUIMessageStream>> {
  logger.debug("Starting task executor", {
    sessionId,
    currentTaskIndex,
    taskCount: plan.todos.length,
  });

  if (
    !plan ||
    !plan.todos ||
    currentTaskIndex < 0 ||
    currentTaskIndex >= plan.todos.length
  ) {
    logger.error("Invalid task index", {
      currentTaskIndex,
      taskCount: plan.todos?.length ?? 0,
    });
    throw new Error(
      `Invalid task index: ${currentTaskIndex}. Plan has ${plan.todos?.length ?? 0} tasks.`,
    );
  }

  // Mark current task as in_progress
  plan.todos[currentTaskIndex].status = "in_progress";

  return createUIMessageStream({
    execute: async ({ writer }) => {
      // Stream the in_progress state to the frontend
      writeSimulatedToolCallToStream({
        writer,
        toolCallId: planToolCallId,
        toolName: "plan",
        input: {
          title: plan.title,
          description: plan.description,
          todos: plan.todos,
        },
        output: plan,
      });

      // Plan and execute subtasks
      const { subtaskPlan, failed } = await planAndExecuteSubtasks(
        sessionId,
        plan,
        currentTaskIndex,
        writer,
      );

      if (!failed) {
        // All subtasks succeeded
        plan.todos[currentTaskIndex].status = "completed";

        logger.info("Task completed successfully", {
          currentTaskIndex,
          taskLabel: plan.todos[currentTaskIndex].label,
        });

        writeSimulatedToolCallToStream({
          writer,
          toolCallId: planToolCallId,
          toolName: "plan",
          input: {
            title: plan.title,
            description: plan.description,
            todos: plan.todos,
          },
          output: plan,
        });
        return;
      }

      // Subtasks failed — call recovery agent
      logger.info("Subtasks failed, calling recovery agent", {
        currentTaskIndex,
      });

      const failedSubtaskIndex = subtaskPlan.todos.findIndex(
        (t) => t.status === "cancelled",
      );
      const failedSubtask = subtaskPlan.todos[failedSubtaskIndex];

      const decision: RecoveryDecision = await recoveryAgent({
        failedSubtask,
        failedSubtaskIndex,
        subtaskPlan,
        currentTask: plan.todos[currentTaskIndex],
        currentTaskIndex,
        plan,
        messages,
        sessionId,
      });

      logger.info("Recovery decision received", {
        level: decision.level,
        reason: decision.reason,
      });

      if (decision.level === "task_executor") {
        // Replan subtasks once with recovery instruction
        logger.info("Recovering at task executor level");

        const { failed: retryFailed } = await planAndExecuteSubtasks(
          sessionId,
          plan,
          currentTaskIndex,
          writer,
          decision.recoveryInstruction,
        );

        if (retryFailed) {
          // Recovery attempt also failed — mark task cancelled
          logger.error("Recovery attempt also failed", {
            currentTaskIndex,
          });
          plan.todos[currentTaskIndex].status = "cancelled";
          plan.todos[currentTaskIndex].receipt = {
            outcome: "failed",
            summary: `Recovery attempt failed: ${decision.reason}`,
            at: new Date().toISOString(),
          };
        } else {
          plan.todos[currentTaskIndex].status = "completed";
          logger.info("Recovery succeeded", { currentTaskIndex });
        }
      } else if (decision.level === "planner") {
        // Signal worker.ts to replan the entire plan
        plan.todos[currentTaskIndex].status = "cancelled";
        plan.todos[currentTaskIndex].receipt = {
          outcome: "failed",
          summary: decision.reason,
          identifiers: {
            recoveryInstruction: decision.recoveryInstruction,
          },
          at: new Date().toISOString(),
        };
      } else {
        // abort
        plan.todos[currentTaskIndex].status = "cancelled";
        plan.todos[currentTaskIndex].receipt = {
          outcome: "cancelled",
          summary: decision.reason,
          at: new Date().toISOString(),
        };
      }

      // Stream final plan state to the frontend
      writeSimulatedToolCallToStream({
        writer,
        toolCallId: planToolCallId,
        toolName: "plan",
        input: {
          title: plan.title,
          description: plan.description,
          todos: plan.todos,
        },
        output: plan,
      });
    },
    onError: (error) => {
      logger.error("Error in task executor stream", {
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return error instanceof Error ? error.message : String(error);
    },
  });
}
