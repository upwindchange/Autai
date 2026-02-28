import { HumanMessage, SystemMessage } from "@langchain/core/messages";
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

	// ============================================================
	// PHASE 1: Tab Selection
	// ============================================================

	// Set sessionId in context for tools to access

	const sessionTabService = SessionTabService.getInstance();
	const activeTabId = sessionTabService.getActiveTabForSession(state.sessionId);
	setContextVariable("sessionId", state.sessionId);
	setContextVariable("activeTabId", activeTabId);

	// ============================================================
	// PHASE 2: Action Execution
	// ============================================================

	const actionExecutorPrompt = new SystemMessage(
		`You are a browser automation action executor. Your role is to execute atomic, concrete browser actions to accomplish the current subtask.

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
When subtask is completed, must call the provided extract-? tool to prepare structured output:
- Set task_status: true if all actions succeeded, false if any failed
- Provide detailed result_explanation describing what was accomplished or why it failed

## Important
- use getFlattenDOMTool to understand state at proper time.
- Always use extract-? tool at the end of task execution to generate structured output.
- Use backendNodeId from DOM analysis to target specific elements
- Each action should move purposefully toward subtask completion
- If an action fails, explain why and mark subtask as failed
- Be thorough in your evaluation - use DOM state + tool return to judge success

Now execute the actions needed to accomplish this subtask.`,
	);

	// Action executor agent with interactive tools (NO getSessionTabsTool)
	const allTools = [getFlattenDOMTool, ...interactiveTools, ...tabControlTools];

	const actionExecutorAgent = createAgent({
		model: complexLangchainModel(),
		tools: allTools,
		responseFormat: toolStrategy(
			z
				.object({
					task_status: z
						.boolean()
						.describe("Whether the task was completed successfully or failed"),
					result_explanation: z
						.string()
						.describe(
							"Explanation of success/failure based on getFlattenDOMTool result and previous tool call results",
						),
				})
				.describe(
					"Use this tool at the very end of agent execution to prepare structured output",
				),
		),
		systemPrompt: actionExecutorPrompt,
	});

	const currentSubtaskContext = new HumanMessage(
		JSON.stringify(currentSubtask),
	);
	const response = await actionExecutorAgent.invoke({
		messages: [currentSubtaskContext],
	});

	// Update subtask status based on success/failure
	const updatedSubtaskPlan = [...(state.subtask_plan || [])];
	updatedSubtaskPlan[currentSubtaskIndex] = {
		...currentSubtask,
		status: response.structuredResponse.task_status ? "completed" : "failed",
		results: [
			...(currentSubtask.results || []),
			response.structuredResponse.result_explanation,
		],
	};

	// If subtask failed, route back to task-executor for replanning
	if (!response.structuredResponse.task_status) {
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
