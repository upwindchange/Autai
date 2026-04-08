import { streamText, stepCountIs, ModelMessage, tool } from "ai";
import { z } from "zod";
import { complexModel } from "@agents/providers";
import { hasSuccessfulToolResult } from "@/agents/utils";
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
      maxVisibleTodos: 4,
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

const plannerSystemPrompt = `You are a browser automation planner. Break down the user's request into logical high-level tasks.

## Your Capabilities
You can control browsers: navigate, interact with pages, fill forms, extract information, and coordinate multi-page workflows.

## Planning Strategy
1. Understand what the user wants to accomplish
2. Identify the logical flow - what must happen first, then next
3. Break into 3-10 major tasks that represent coherent phases

## Plan Format
Generate a plan with this structure:
- title: Short human-readable title of the plan
- description: Optional detailed description
- todos: Array of todo items, where each todo has:
  - label: Short title of the step
  - status: Always start with "pending"
  - description: Detailed description of what this step involves

## Important
- Each todo will be expanded into subtasks by another AI
- Think at the "what" level, not "how"
- Example: "Log in to the site" is ONE task. Another AI will expand it to: find login form → enter username → enter password → submit
- If complex, break into more tasks rather than fewer

## Tool Usage
Call generatePlan with the complete plan (including title, description, todos array).

Now create the execution plan.`;

// ===== Main Exported Function =====

export async function browserUsePlanner(
  messages: ModelMessage[],
  sessionId: string,
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
