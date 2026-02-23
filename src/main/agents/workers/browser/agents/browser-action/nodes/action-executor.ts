import { SystemMessage } from "@langchain/core/messages";
import { BrowserActionStateType } from "../state";
import { complexLangchainModel } from "@/agents/providers";
import { createAgent, toolStrategy } from "langchain";
import { Command } from "@langchain/langgraph";
import { z } from "zod";
import { interactiveTools } from "@/agents/tools/InteractiveTools";
import { tabControlTools } from "@/agents/tools/TabControlTools";
import { getSessionTabsTool, getTabInfoTool, createTabTool } from "@/agents/tools/SessionTabTools";
import { getFlattenDOMTool } from "@/agents/tools/DOMTools";
import { setContextVariable } from "@langchain/core/context";

export async function browserActionExecutorNode(
	state: BrowserActionStateType,
): Promise<Command> {
	// Get current subtask index from state (set by task-executor)
	const currentSubtaskIndex = state.current_subtask_index;

	// If no subtask index set or out of bounds, all subtasks are done
	if (
		currentSubtaskIndex === -1 ||
		currentSubtaskIndex >= (state.subtask_plan?.length || 0)
	) {
		return new Command({
			update: {
				// Clear the index when all subtasks are done
				current_subtask_index: -1,
			},
			goto: "task-executor",
		});
	}

	const currentSubtask = state.subtask_plan[currentSubtaskIndex];

	// Build context
	const subtaskContext = JSON.stringify(currentSubtask, null, 2);
	const allSubtasksContext = JSON.stringify(state.subtask_plan, null, 2);

	// ============================================================
	// PHASE 1: Tab Selection
	// ============================================================

	// Set sessionId in context for tools to access
	setContextVariable("sessionId", state.sessionId);

	const tabSelectorSystemPrompt = new SystemMessage(
		`You are a tab selector. Your role is to determine which tab should be used for the current subtask.

## Current Subtask
${subtaskContext}

## Your Responsibilities
1. Use getSessionTabsTool to see all available tabs
2. Determine which tab is appropriate for the subtask:
   - Use the active tab if it matches the requirements
   - Select a different tab if the subtask requires a specific URL/content
   - Create a new tab if no suitable tab exists
3. Output the selected tabId and explanation

## Output Format
- selectedTabId: The tab ID to use (string)
- explanation: Why this tab was chosen (string)

Now select the appropriate tab for this subtask.`,
	);

	// Tab selector agent with tab management tools only
	const tabSelectorAgent = createAgent({
		model: complexLangchainModel(),
		tools: [getSessionTabsTool, getTabInfoTool, createTabTool],
		responseFormat: toolStrategy(
			z.object({
				selectedTabId: z.string().describe("The tab ID to use"),
				explanation: z.string().describe("Why this tab was chosen"),
			}),
		),
		systemPrompt: tabSelectorSystemPrompt,
	});

	const tabSelectorResponse = await tabSelectorAgent.invoke({ messages: state.messages });

	// Set the selected tabId in context for action executor to use
	setContextVariable("activeTabId", tabSelectorResponse.structuredResponse.selectedTabId);

	// ============================================================
	// PHASE 2: Action Execution
	// ============================================================

	const actionExecutorSystemPrompt = new SystemMessage(
		`You are a browser automation action executor. Your role is to execute atomic, concrete browser actions to accomplish the current subtask.

## Execute only this Current Subtask
${subtaskContext}

## All Subtasks Context (offered to you just as context, no execution to any tasks here except for the current subtask listed above)
${allSubtasksContext}

## Selected Tab Context
Tab ID: ${tabSelectorResponse.structuredResponse.selectedTabId}
Explanation: ${tabSelectorResponse.structuredResponse.explanation}

## Your Capabilities
You have access to tools for:
- Interactive elements: click, fill, select, hover, drag
- Page navigation: navigate, refresh, go back, go forward
- Page scrolling: scroll by pages or at coordinates
- DOM analysis: getFlattenDOMTool (LLM-optimized flattened DOM representation)
- Element inspection: get attributes, evaluate JavaScript, get basic info

## Important: Tab Context
The active tab has been pre-selected for you. All interactive tools will automatically use this tab context - you do NOT need to specify tabId in your tool calls.

## DOM Representation Format
The getFlattenDOMTool returns a simplified DOM representation. Here's how to read it:

### Element Markers
- \`[N]<tag>\` - Interactive element with backendNodeId N. Use this number in tools like clickElementTool, fillElementTool.
- \`*[N]<tag>\` - NEW element (first observation since last check). Useful for detecting page changes.
- \`|SCROLL[N]<tag>\` - Scrollable AND interactive. Can scroll this container.
- \`|SCROLL|<tag>\` - Scrollable but NOT clickable. Use scrollPagesTool instead.
- \`|IFRAME|<iframe>\` / \`|FRAME|<frame>\` - Embedded frame elements.
- \`|SHADOW(open)|\` / \`|SHADOW(closed)|\` - Shadow DOM boundary indicator.

### Structure
- Tab indentation shows nesting (child elements are indented under parents)
- Text content appears on separate lines without brackets
- Key attributes are included: role, aria-label, placeholder, value, type, etc.
- Scroll position: \`scroll: horizontal: X%, vertical: Y%\`

### Example
\`\`\`
[49]<div role=navigation />
    [52]<a>About</a>
    [64]<a aria-label=Search for Images>Images</a>
    *[68]<button expanded=false>Menu</button>
\`\`\`

To click "Menu" button, use: clickElementTool with backendNodeId=68

## Your Responsibilities
1. Use getFlattenDOMTool FIRST to understand the current page state
2. Identify which atomic actions are needed to accomplish the subtask
3. Execute actions sequentially using appropriate tools
4. **CRITICAL:** After EVERY action, use getFlattenDOMTool to evaluate the result
5. Use BOTH getFlattenDOMTool result AND previous tool return value to judge success/failure
6. Continue executing actions until the subtask is fully accomplished
7. After all actions complete, update the subtask with success/fail status and explanation

## Execution Pattern
For each action:
1. Execute action tool (click, fill, navigate, etc.)
2. Call getFlattenDOMTool to see updated page state
3. Compare before/after DOM states
4. Analyze tool return value
5. Judge if action succeeded based on DOM changes + tool return
6. Continue to next action or retry if needed

## Success/Failure Judgment
Based on:
- getFlattenDOMTool result: Did the DOM change as expected?
- Tool return value: Did the tool report success?
- Current page state: Does it match expected outcome?

## Subtask Result
When subtask is completed:
- Set subtask_success: true if all actions succeeded, false if any failed
- Provide detailed result_explanation describing what was accomplished or why it failed

## Important
- Always use getFlattenDOMTool BEFORE the first action to understand initial state
- Always use getFlattenDOMTool AFTER EVERY action to evaluate results
- Use backendNodeId from DOM analysis to target specific elements
- Each action should move purposefully toward subtask completion
- If an action fails, explain why and either retry or mark subtask as failed
- Be thorough in your evaluation - use DOM state + tool return to judge success

Now execute the actions needed to accomplish this subtask.`,
	);

	// Action executor agent with interactive tools (NO getSessionTabsTool)
	const allTools = [
		getFlattenDOMTool,
		...interactiveTools,
		...tabControlTools,
	];

	const actionExecutorAgent = createAgent({
		model: complexLangchainModel(),
		tools: allTools,
		responseFormat: toolStrategy(
			z.object({
				subtask_success: z
					.boolean()
					.describe("Whether the subtask was completed successfully or failed"),
				result_explanation: z
					.string()
					.describe(
						"Explanation of success/failure based on getFlattenDOMTool result and previous tool call results",
					),
			}),
		),
		systemPrompt: actionExecutorSystemPrompt,
	});

	const response = await actionExecutorAgent.invoke({ messages: state.messages });

	// Update subtask status based on success/failure
	const updatedSubtaskPlan = [...(state.subtask_plan || [])];
	updatedSubtaskPlan[currentSubtaskIndex] = {
		...updatedSubtaskPlan[currentSubtaskIndex],
		status:
			response.structuredResponse.subtask_success ? "completed" : "failed",
		results: [
			...(updatedSubtaskPlan[currentSubtaskIndex].results || []),
			response.structuredResponse.result_explanation,
		],
	};

	// If subtask failed, route back to task-executor for replanning
	if (!response.structuredResponse.subtask_success) {
		return new Command({
			update: {
				current_subtask_index: currentSubtaskIndex,
				subtask_plan: updatedSubtaskPlan,
			},
			goto: "task-executor", // Always go back on failure
		});
	}

	// If successful, move to next subtask (increment index)
	const nextSubtaskIndex = currentSubtaskIndex + 1;

	// Check if there are more subtasks to process
	const hasMoreSubtasks = nextSubtaskIndex < updatedSubtaskPlan.length;

	return new Command({
		update: {
			// Increment index or set to -1 if all done
			current_subtask_index: hasMoreSubtasks ? nextSubtaskIndex : -1,
			subtask_plan: updatedSubtaskPlan,
		},
		goto: hasMoreSubtasks ? "action-executor" : "task-executor",
	});
}
