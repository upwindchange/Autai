import {
	Annotation,
	MessagesAnnotation,
	StateGraph,
} from "@langchain/langgraph";
import { z } from "zod";

export const PlanSchema = z.object({
	id: z
		.string()
		.min(1)
		.describe(
			"Unique identifier for this plan, will be given by system prompt",
		),
	title: z.string().min(1).describe("Plan title displayed as the header"),
	description: z
		.string()
		.optional()
		.describe("Context description below the title"),
	todos: z
		.array(
			z.object({
				id: z
					.string()
					.regex(/^\d+$/, "Todo ID must be a string number like '1', '2', '3'")
					.describe("Unique todo identifier as string number"),
				label: z.string().min(1).describe("Display text"),
				status: z
					.enum(["pending", "in_progress", "completed", "cancelled"])
					.describe("Current state"),
				description: z.string().optional().describe("Expandable detail text"),
				results: z
					.array(z.string())
					.optional()
					.describe("Evaluation result explanations from action-executor"),
			}),
		)
		.min(1)
		.describe("Array of todo items - minimum 1 required"),
	maxVisibleTodos: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe("Items to show before collapsing"),
});

export type Plan = z.infer<typeof PlanSchema>;

const BrowserActionState = Annotation.Root({
	...MessagesAnnotation.spec,
	mode: Annotation<string>,
	sessionId: Annotation<string>,
	task_plan: Annotation<Plan>,
	current_task_index: Annotation<number>, // -1 means no active task
	subtask_plan: Annotation<Plan>,
	current_subtask_index: Annotation<number>, // -1 means no active subtask
	response: Annotation<string>,
});

// Extract the state type for function signatures
export type BrowserActionStateType = typeof BrowserActionState.State;

export const graph_builder = new StateGraph(BrowserActionState);
