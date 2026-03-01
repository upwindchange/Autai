import {
	HumanMessage,
	SystemMessage,
	BaseMessage,
} from "@langchain/core/messages";
import { BrowserActionStateType } from "../state";
import { complexLangchainModel } from "@/agents/providers";
import { createAgent, toolStrategy } from "langchain";
import { Command } from "@langchain/langgraph";
import { z } from "zod";
import { interactiveTools } from "@/agents/tools/InteractiveTools";
import { tabControlTools } from "@/agents/tools/TabControlTools";
import { getFlattenDOMTool } from "@/agents/tools/DOMTools";
import { setContextVariable } from "@langchain/core/context";
import { SessionTabService } from "@/services";

export async function browserActionExecutorNode(
	state: BrowserActionStateType,
): Promise<Command> {
	// Get all subtasks
	const subtaskPlan = state.subtask_plan || [];

	if (subtaskPlan.length === 0) {
		// No subtasks, return to task-executor
		return new Command({
			update: {
				current_subtask_index: -1,
			},
			goto: "task-executor",
		});
	}

	// ============================================================
	// SET CONTEXT (once for all subtasks)
	// ============================================================
	const sessionTabService = SessionTabService.getInstance();
	const activeTabId = sessionTabService.getActiveTabForSession(state.sessionId);
	setContextVariable("sessionId", state.sessionId);
	setContextVariable("activeTabId", activeTabId);

	// ============================================================
	// CREATE AGENT (once for all subtasks)
	// ============================================================
	const actionExecutorPrompt = new SystemMessage(
		`# Role
Browser automation action executor. Execute subtasks sequentially using browser tools.

# Available Tools
Interactive elements: click, fill, select, hover, drag
Page navigation: navigate, refresh, go back, go forward
Page scrolling: scroll by pages or at coordinates
DOM analysis: getFlattenDOMTool (flattened DOM representation)
Element inspection: get attributes, evaluate JavaScript, get basic info

# Tab Context
Active tab is pre-selected. All interactive tools use this tab automatically. Do NOT specify tabId.

# DOM State Management Rules

## Call getFlattenDOMTool:
1. First action of each subtask
2. After state-changing actions: clickElementTool, navigateTool, refreshTool, fillElementTool with submit=true
3. After 3+ actions without checking DOM
4. When uncertain about page state

## Skip getFlattenDOMTool:
1. After read-only actions: getElementAttributeTool, evaluateJavaScriptTool (reading), scrollPagesTool
2. If called within last 2 actions and page unchanged
3. If you already have the element's backendNodeId from previous action

## BackendNodeId Persistence
backendNodeId values persist across subtasks. If you found backendNodeId=123 in subtask 1, it remains valid in subtask 2. Use this knowledge to skip unnecessary DOM checks.

# DOM Format Reference

## Element Markers
[N]<tag> - Interactive element with backendNodeId N
*[N]<tag> - NEW element (first observation since last check)
|SCROLL[N]<tag> - Scrollable AND interactive
|SCROLL|<tag> - Scrollable but NOT interactive
|IFRAME|<iframe> / |FRAME|<frame> - Embedded frame
|SHADOW(open)| / |SHADOW(closed)| - Shadow DOM boundary

## Structure
Tab indentation = nesting level
Text content = separate lines without brackets
Attributes included: role, aria-label, placeholder, value, type, etc.
Scroll position: scroll: horizontal: X%, vertical: Y%

## Example
[49]<div role=navigation />
    [52]<a>About</a>
    [64]<a aria-label=Search for Images>Images</a>
    *[68]<button expanded=false>Menu</button>

To click "Menu": clickElementTool with backendNodeId=68

# Execution Flow

For each subtask:
1. Call getFlattenDOMTool to understand initial state
2. Note: "No DOM tree available" means no page loaded. Browser and tab are always available. Proceed normally.
3. Use backendNodeId from previous results when available
4. Execute actions sequentially
5. After each action: judge if it changed page state
   - Changed: Call getFlattenDOMTool
   - Unchanged: Skip getFlattenDOMTool
6. Judge success using BOTH DOM changes AND tool return value
7. Continue until subtask complete

# Critical Reminders
- backendNodeId persists across subtasks - reuse them
- Judge success using DOM state + tool return
- If action fails, explain why and mark subtask as failed`,
	);

	const allTools = [getFlattenDOMTool, ...interactiveTools, ...tabControlTools];

	const actionExecutorAgent = createAgent({
		model: complexLangchainModel(),
		tools: allTools,
		responseFormat: toolStrategy(
			z.object({
				is_task_successful: z.boolean(),
				result_explanation: z.string(),
			}),
		),
		systemPrompt: actionExecutorPrompt,
	});

	// ============================================================
	// INTERNAL SUBTASK LOOP
	// ============================================================
	const results: typeof subtaskPlan = [];
	let agentMessages: BaseMessage[] = []; // Internal message accumulator

	for (let i = 0; i < subtaskPlan.length; i++) {
		const currentSubtask = subtaskPlan[i];

		// Build HumanMessage with:
		// 1. All previous completed subtasks (summary)
		// 2. Current subtask to execute
		let subtaskContext = "";

		if (i > 0) {
			// Add completed subtasks as context
			const completedSubtasks = results.slice(0, i);
			subtaskContext += `## Previously Completed Subtasks:\n${JSON.stringify(completedSubtasks, null, 2)}\n\n`;
		}

		subtaskContext += `## Current Subtask to Execute:\n${JSON.stringify(currentSubtask, null, 2)}`;

		const currentSubtaskMessage = new HumanMessage(subtaskContext);

		// Invoke agent with accumulated messages + new subtask
		const response = await actionExecutorAgent.invoke({
			messages: [...agentMessages, currentSubtaskMessage],
		});

		// Update subtask status
		const updatedSubtask = {
			...currentSubtask,
			status: (response.structuredResponse.is_task_successful ?
				"completed"
			:	"failed") as "completed" | "failed",
			results: [
				...(currentSubtask.results || []),
				response.structuredResponse.result_explanation,
			],
		};
		results.push(updatedSubtask);

		// Accumulate messages for next subtask
		// Only keep the agent's responses (tool calls, results), not the subtask instruction
		agentMessages = [...agentMessages, ...response.messages];

		// OPTIMIZATION: Trim messages to avoid bloat
		// Strategy: Keep only recent messages to limit token usage
		if (agentMessages.length > 50) {
			// Threshold: trim after 50 messages
			// Simple approach: keep last 30 messages
			agentMessages = agentMessages.slice(-30);
		}

		// If subtask failed, stop and return to task-executor for replanning
		if (!response.structuredResponse.is_task_successful) {
			return new Command({
				update: {
					subtask_plan: [
						...results.slice(0, i), // Previously completed subtasks with correct status
						updatedSubtask, // Current failed subtask
					],
					current_subtask_index: i,
				},
				goto: "task-executor", // Replan needed
			});
		}
	}

	// ============================================================
	// ALL SUBTASKS COMPLETED - RETURN
	// ============================================================
	return new Command({
		update: {
			subtask_plan: results,
			current_subtask_index: -1, // All done
		},
		goto: "task-executor",
	});
}
