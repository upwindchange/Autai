/**
 * Plan Display Tool for AI Agents
 *
 * Displays execution plans with tasks and their status to the user.
 * This tool is called by the planner agent to present a plan in the UI.
 */

import { tool } from "langchain";
import { z } from "zod";
import { PlanSchema } from "@/agents/workers/browser/agents/browser-action/state";
import { interrupt } from "@langchain/langgraph";
import log from "electron-log/main";

const logger = log.scope("PlanTool");

/**
 * showPlan tool - Display an execution plan and wait for human approval
 *
 * The tool accepts a plan structure (without results field) and interrupts
 * execution to wait for human approval (approve/edit/reject).
 *
 * Input plan should have the results field already stripped by the caller.
 *
 * When resumed:
 * - approve: Returns the original plan
 * - edit: Returns the edited plan
 * - reject: Throws an error to stop execution
 *
 * Note: This tool uses LangGraph's interrupt() to pause graph execution.
 */
export const showPlanTool = tool(
	async (input: z.infer<typeof PlanSchema>) => {
		logger.info("showPlan tool called, waiting for human approval", {
			planId: input.id,
			taskCount: input.todos.length,
		});

		// Interrupt execution and wait for human decision
		const decision = await interrupt({
			action: "showPlan",
			plan: input,
			question:
				"Please review and approve this execution plan before proceeding.",
		});

		logger.info("Human decision received", {
			decisionType: decision.type,
			planId: input.id,
		});

		// Handle rejection - throw error to signal workflow termination
		if (decision.type === "reject") {
			const errorMessage =
				decision.message || "Plan rejected by user";
			logger.info("Plan rejected", { message: errorMessage });
			throw new Error(errorMessage);
		}

		// Handle edit - return the edited plan
		if (decision.type === "edit" && decision.editedPlan) {
			logger.info("Plan edited by user", {
				originalTaskCount: input.todos.length,
				editedTaskCount: decision.editedPlan.todos.length,
			});
			return decision.editedPlan;
		}

		// Handle approve - return the original plan
		logger.info("Plan approved by user", {
			taskCount: input.todos.length,
		});
		return input;
	},
	{
		name: "showPlan", // Must match frontend toolkit name
		description:
			"Display an execution plan to the user and wait for approval (approve/edit/reject)",
		schema: PlanSchema,
	},
);
