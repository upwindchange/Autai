import {
	Annotation,
	MessagesAnnotation,
	StateGraph,
} from "@langchain/langgraph";
import { z } from "zod";

export const PlanItemSchema = z.object({
	id: z
		.string()
		.regex(
			/^\d+$/,
			"Must be a string representation of a number (e.g., '1', '2', '3')",
		)
		.describe(
			"identifier for the plan step, string of a number (e.g., '1', '2', '3'), incrementally increasing from '1' to the step number",
		),
	label: z.string().describe("Short human-readable title of the step"),
	status: z
		.enum(["pending", "in_progress", "completed", "failed"])
		.describe("Current status of this plan step"),
	description: z
		.string()
		.describe("Detailed description of what this step involves"),
	results: z
		.array(z.any())
		.optional()
		.describe(
			"Array of BaseMessage objects from tool execution results for this step, do not populate this field, will be populated manually",
		)
		.default([]),
});

export const PlanSchema = z
	.array(PlanItemSchema)
	.describe("Array of plan steps representing the execution plan");

export type Plan = z.infer<typeof PlanSchema>;

const BrowserActionState = Annotation.Root({
	...MessagesAnnotation.spec,
	mode: Annotation<string>,
	task_plan: Annotation<Plan>,
	current_task_index: Annotation<number>,
	subtask_plan: Annotation<Plan>,
	current_subtask_index: Annotation<number>,
	response: Annotation<string>,
});

// Extract the state type for function signatures
export type BrowserActionStateType = typeof BrowserActionState.State;

export const graph_builder = new StateGraph(BrowserActionState);
