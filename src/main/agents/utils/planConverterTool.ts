import { tool, ToolRuntime } from "langchain";
import z from "zod";
import {
  PlanItemSchema,
  PlanSchema,
  BrowserActionStateType,
} from "@agents/workers/browser/agents/browser-action/state";

// Local schema definitions for UI plan structure
const PlanTodoStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

const PlanTodoSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: PlanTodoStatusSchema,
  description: z.string().optional(),
});

const _SerializablePlanSchema = z.object({
  id: z.string().min(1),
  role: z.string().optional(),
  receipt: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  todos: z.array(PlanTodoSchema).min(1),
  maxVisibleTodos: z.number().int().min(1).optional(),
});

export type PlanTodo = z.infer<typeof PlanTodoSchema>;
export type SerializablePlan = z.infer<typeof _SerializablePlanSchema>;

function convertUIPlanItem(
  planItem: z.infer<typeof PlanItemSchema>,
  id: string,
): PlanTodo {
  const statusMap: Record<string, z.infer<typeof PlanTodoStatusSchema>> = {
    pending: "pending",
    in_progress: "in_progress",
    completed: "completed",
    failed: "cancelled", // Map "failed" to "cancelled" for UI
  };

  return {
    id: "sub" + id + "-" + planItem.id,
    label: planItem.label,
    status: statusMap[planItem.status] || "pending",
    description: planItem.description,
  };
}

export function createUIPlan(
  plan: z.infer<typeof PlanSchema>,
  id: string,
): SerializablePlan {
  return {
    id,
    title: plan.title,
    todos: plan.steps.map((item) => convertUIPlanItem(item, id)),
  };
}

export const convertPlanToUiTool = tool(
  async (input, config: ToolRuntime<BrowserActionStateType>) => {
    // Accept task_plan as input, but use runtime for sessionId
    const { task_plan } = input;

    if (!task_plan || !task_plan.steps || task_plan.steps.length === 0) {
      return JSON.stringify({
        error: "No plan provided",
        id: "plan-" + config.state.sessionId,
        title: "Error",
        todos: [],
      });
    }

    // Use sessionId from runtime for consistent ID
    const id = "plan-" + config.state.sessionId;
    const serializablePlan = createUIPlan(task_plan, id);
    return JSON.stringify(serializablePlan);
  },
  {
    name: "showPlan",
    description:
      "Display the browser automation execution plan in the UI. Pass the task_plan as input.",
    schema: z.object({
      task_plan: PlanSchema,
    }),
  },
);

export const awaitPlanApprovalTool = tool(
  async () => {
    // This tool is only for HITL interruption
    // The actual approval happens via the middleware
    return {
      status: "approved",
      message: "Plan approved by user",
    };
  },
  {
    name: "awaitPlanApproval",
    description:
      "Wait for human approval before proceeding with the browser automation plan. This should be called SECOND, after showPlan.",
    schema: z.object({
      // No parameters needed
    }),
  },
);
