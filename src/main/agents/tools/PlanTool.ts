/**
 * Plan Display Tool for AI Agents
 *
 * Displays execution plans with tasks and their status to the user.
 * This tool is called by the planner agent to present a plan in the UI.
 */

import { tool } from "langchain";
import { z } from "zod";
import { PlanSchema } from "@/agents/workers/browser/agents/browser-action/state";
import { ToolMessage } from "@langchain/core/messages";
import log from "electron-log/main";

const logger = log.scope("PlanTool");

/**
 * showPlan tool - Display an execution plan to the user
 *
 * The tool accepts a plan structure with title, description, and todos.
 * When called, the plan is rendered in the frontend using the Plan component.
 *
 * Note: This tool simply returns the input data. The actual parsing and
 * handling is done by the planner node which extracts the plan from
 * the tool call message.
 */
export const showPlanTool = tool(
	async (input: z.infer<typeof PlanSchema>) => {
		// Log the tool message as requested
		const toolMessage = new ToolMessage({
			content: JSON.stringify(input, null, 2),
			tool_call_id: "plan-display",
			name: "showPlan",
		});

		logger.info("Plan Tool Message Created:", {
			toolCallId: toolMessage.tool_call_id,
			content: toolMessage.content,
			name: toolMessage.name,
		});

		// Return the plan data for frontend display
		return input;
	},
	{
		name: "showPlan", // Must match frontend toolkit name
		description:
			"Display an execution plan to the user with tasks and their status",
		schema: PlanSchema,
	},
);
