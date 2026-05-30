import { streamText, stepCountIs, ModelMessage, tool } from "ai";
import { z } from "zod";
import { complexModel } from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@/agents/utils";
import { settingsService } from "@/services";
import log from "electron-log/main";

const logger = log.scope("browser-use-planner");

// ===== Local Type Definitions =====
// These match the renderer's ToolUIReceipt schema but are defined locally
// since main process cannot import from renderer

type ToolUIReceiptOutcome = "success" | "partial" | "failed" | "cancelled";

interface ToolUIReceipt {
  outcome: ToolUIReceiptOutcome;
  summary: string;
  identifiers?: Record<string, string>;
  at: string;
}

// ===== Result Types =====
// from src/renderer/components/tool-ui/plan/plan.tsx

export interface UIPlanTodo {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  description?: string;
  receipt?: ToolUIReceipt;
}

export interface UIPlanType {
  id: string;
  title: string;
  description: string;
  todos: UIPlanTodo[];
  maxVisibleTodos?: number;
  receipt?: ToolUIReceipt;
  requiresApproval?: boolean;
}

// ===== Plan Schema =====
// For AI tool input

export const todoInputSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe("Short human-readable title of the todo item"),
  status: z
    .enum(["pending", "in_progress", "completed", "cancelled"])
    .default("pending")
    .describe("Current status of this todo item"),
  description: z
    .string()
    .min(1)
    .describe("Detailed description of what this todo item involves"),
});

export const planInputSchema = z.object({
  title: z.string().min(1).describe("Short human-readable title of the plan"),
  description: z.string().min(1).describe("Detailed description of the plan"),
  todos: z
    .array(todoInputSchema)
    .min(1)
    .describe("Array of todo items representing the plan steps"),
});

// ===== Tool Definitions =====

const generatePlanTool = tool({
  description: "Generate a browser automation execution plan",
  inputSchema: planInputSchema,
  execute: async (input, { experimental_context }) => {
    const context = experimental_context as { sessionId: string };
    // Populate plan id and maxVisibleTodos
    const plan = {
      ...input,
      id: `plan-${context.sessionId}`,
      maxVisibleTodos: 6,
    };
    // Populate todo ids
    plan.todos = plan.todos.map((todo, index) => ({
      ...todo,
      id: `task-${context.sessionId}-${index}`,
    }));
    // Return populated plan
    return plan;
  },
});

// ===== System Prompt =====

const plannerSystemPrompt = `You are a browser automation planner. Break down the user's request into specific, actionable steps that can be directly executed using browser tools.

## Your Capabilities
You can control browsers: navigate, interact with pages, fill forms, extract information, and coordinate multi-page workflows.

## Planning Strategy
1. Understand what the user wants to accomplish
2. Identify the logical flow - what must happen first, then next
3. Break into actionable steps at the instruction level

## Plan Format
Generate a plan with this structure:
- title: Short human-readable title of the plan
- description: Detailed description of the plan
- todos: Array of todo items, where each todo has:
  - label: Brief action title (e.g., "Navigate to login page and locate login form")
  - status: Always start with "pending"
  - description: Clear instructions on what this step should accomplish

## Step Guidelines
- Group related actions together into coherent steps
- Browser and tab are always available. Do NOT plan setup tasks like "open browser" or "ensure tab is ready"
- Write instructional descriptions that guide the action-executor agent
- Do NOT break into atomic actions (click, type). That is for the action-executor agent
- Consider page state from previous steps when writing instructions
- Do NOT design a task to dismiss popup/overlay

## Example
If the user wants to "Log in to example.com and check messages", create:
1. "Navigate to example.com" - Go to the website URL
2. "Locate and navigate to the login portal" - Find and access the login page
3. "Find the username and password input fields" - Locate the login form elements
4. "Fill in the credentials and submit" - Enter username and password, submit the form
5. "Navigate to the messages section" - After login, go to the messages area
6. "Review and summarize messages" - Read the messages and provide a summary

## Important
- Produce steps that can each be accomplished as a unit of browser interaction
- Think at the "instructional" level - what the action executor should do, not individual clicks
- If complex, break into more steps rather than fewer

## Tool Usage
Call generatePlan with the complete plan (including title, description, todos array).

Now create the execution plan.`;

// ===== Main Exported Function =====

export async function browserUsePlanner(
  messages: ModelMessage[],
  sessionId: string,
  signal?: AbortSignal,
) {
  logger.debug("Starting planner", {
    sessionId,
    messageCount: messages.length,
  });

  // Create a context for tool execution
  const context = {
    sessionId,
  };

  const result = streamText({
    model: complexModel(),
    messages,
    system: plannerSystemPrompt,
    tools: {
      plan: generatePlanTool,
    },
    toolChoice: {
      type: "tool",
      toolName: "plan",
    },
    stopWhen: [hasSuccessfulToolResult("plan"), stepCountIs(100)],
    timeout: TIMEOUTS.planning,
    abortSignal: signal,
    experimental_context: context,
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "browser-use-planner",
    },
  });

  // Log when plan generation completes (in background)
  result.finishReason.then((reason) => {
    logger.info("Planner stream completed", {
      finishReason: reason,
    });
  });

  return result;
}

// ===== Replanner =====

/**
 * Build system prompt for replanning after a task failure or executor request
 */
function buildReplannerSystemPrompt(
  previousPlan: UIPlanType,
  replanFromIndex: number,
  reason?: string,
): string {
  const completedTodos = previousPlan.todos
    .slice(0, replanFromIndex)
    .filter((t) => t.status === "completed");
  const taskAtPosition =
    replanFromIndex < previousPlan.todos.length ?
      previousPlan.todos[replanFromIndex]
    : null;
  const remainingTodos = previousPlan.todos
    .slice(replanFromIndex + 1)
    .filter((t) => t.status === "pending");

  let completedSection = "";
  if (completedTodos.length > 0) {
    completedSection = `
## Already Completed
${JSON.stringify(completedTodos, null, 2)}`;
  }

  let taskAtPositionSection = "";
  if (taskAtPosition) {
    taskAtPositionSection = `
## Task at Replan Position
${JSON.stringify(taskAtPosition, null, 2)}`;
  }

  let remainingSection = "";
  if (remainingTodos.length > 0) {
    remainingSection = `
## Remaining Steps (not yet attempted)
${JSON.stringify(remainingTodos, null, 2)}`;
  }

  let reasonSection = "";
  if (reason) {
    reasonSection = `
## Reason for Replanning
${reason}

This replan was triggered by the action executor based on what it encountered on the page. The replan may have been requested because:
- Page structure differs from what the plan assumed
- Steps are achievable in a different order than planned
- A redirect or page change completed or invalidated other planned tasks
- New information discovered during execution changes the approach`;
  }

  return `You are replanning a browser automation task.

## Original Goal
${previousPlan.description}

${completedSection}

${taskAtPositionSection}

${remainingSection}

${reasonSection}

## Your Responsibility
1. Analyze what went wrong or what changed and adjust the approach
2. Replan from the replan position and any remaining steps
3. Consider whether remaining steps need modification given the new context
4. Do NOT include already-completed steps
5. Do NOT simply repeat the same plan - adjust based on the new information

## Step Guidelines
- Group related actions together into coherent steps
- Browser and tab are always available. Do NOT plan setup tasks like "open browser" or "ensure tab is ready"
- Write instructional descriptions that guide the action-executor agent
- Do NOT break into atomic actions (click, type). That is for the action-executor agent
- Consider page state from previous steps when writing instructions
- Do NOT design a task to dismiss popup/overlay

## Plan Format
Generate a plan with this structure:
- title: Short human-readable title of the plan
- description: Detailed description of the plan
- todos: Array of todo items, where each todo has:
  - label: Brief action title
  - status: Always start with "pending"
  - description: Clear instructions on what this step should accomplish

## Tool Usage
Call generatePlan with the revised plan for remaining work.`;
}

/**
 * Replan after a task failure or executor request
 *
 * Produces a new plan for the remaining work, taking into account
 * which steps completed and why replanning was requested.
 */
export async function browserUseReplanner(
  sessionId: string,
  previousPlan: UIPlanType,
  replanFromIndex: number,
  reason?: string,
  signal?: AbortSignal,
) {
  logger.debug("Starting replanner", {
    sessionId,
    replanFromIndex,
    previousPlanId: previousPlan.id,
    hasReason: !!reason,
  });

  const systemPrompt = buildReplannerSystemPrompt(
    previousPlan,
    replanFromIndex,
    reason,
  );

  const result = streamText({
    model: complexModel(),
    messages: [
      {
        role: "user",
        content: "Create the revised plan for the remaining work.",
      },
    ],
    system: systemPrompt,
    tools: {
      plan: generatePlanTool,
    },
    toolChoice: {
      type: "tool",
      toolName: "plan",
    },
    stopWhen: [hasSuccessfulToolResult("plan"), stepCountIs(100)],
    timeout: TIMEOUTS.planning,
    abortSignal: signal,
    experimental_context: { sessionId },
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "browser-use-replanner",
      metadata: {
        replanFromIndex,
        previousPlanId: previousPlan.id,
      },
    },
  });

  result.finishReason.then((reason) => {
    logger.info("Replanner stream completed", {
      finishReason: reason,
    });
  });

  return result;
}
