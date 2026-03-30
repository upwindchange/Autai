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
import { retryMiddleware } from "@agents/utils";

export async function browserActionExecutorNode(
  state: BrowserActionStateType,
): Promise<Command> {
  // Get all subtasks
  const subtaskPlan = state.subtask_plan || { title: "", steps: [] };

  if (subtaskPlan.steps.length === 0) {
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
6. Continue until subtask complete or determined to fail

# Output Format
After completing a subtask, provide a text summary that includes:
- What actions were taken
- What the final DOM state shows
- Any errors or unexpected behavior
- Your assessment of whether the subtask goal was achieved

This summary will be reviewed by an evaluator agent to make the final success/failure determination.`,
  );

  const allTools = [getFlattenDOMTool, ...interactiveTools, ...tabControlTools];

  const actionExecutorAgent = createAgent({
    model: complexLangchainModel(),
    tools: allTools,
    systemPrompt: actionExecutorPrompt,
    middleware: retryMiddleware,
  });

  // ============================================================
  // CREATE EVALUATOR AGENT
  // ============================================================
  const evaluatorPrompt = new SystemMessage(
    `# Role
Subtask evaluation agent. Judge if a subtask was successfully completed.

# Your Task
Evaluate whether the current subtask was accomplished based on:
1. The subtask's description and goal
2. The action-executor's execution summary
3. The current DOM state

# Evaluation Criteria
- Success: The subtask's goal is achieved based on execution summary and DOM state
- Failure: The goal was not achieved, or the action-executor encountered errors

# Output
Provide structured evaluation with:
- is_task_successful: boolean
- result_explanation: string (clear explanation of why it succeeded or failed)

# Important Context
- DOM state may show "No DOM tree available" if no page is loaded
- The action-executor's summary describes what actions were taken
- Compare the expected outcome (subtask description) with actual DOM state`,
  );

  const evaluatorAgent = createAgent({
    model: complexLangchainModel(),
    responseFormat: toolStrategy(
      z.object({
        is_task_successful: z
          .boolean()
          .describe(
            "boolean: true if task is successful, false if task failed",
          ),
        result_explanation: z
          .string()
          .describe("text explanation of the task result"),
      }),
      { handleError: true },
    ),
    systemPrompt: evaluatorPrompt,
    middleware: retryMiddleware,
  });

  // ============================================================
  // INTERNAL SUBTASK LOOP
  // ============================================================
  const results: typeof subtaskPlan.steps = [];
  let agentMessages: BaseMessage[] = []; // Internal message accumulator

  for (let i = 0; i < subtaskPlan.steps.length; i++) {
    const currentSubtask = subtaskPlan.steps[i];

    // Build context for action executor
    let subtaskContext = "";

    if (i > 0) {
      const completedSubtasks = results.slice(0, i);
      subtaskContext += `## Previously Completed Subtasks:\n${JSON.stringify(completedSubtasks, null, 2)}\n\n`;
    }

    subtaskContext += `## Current Subtask to Execute:\n${JSON.stringify(currentSubtask, null, 2)}`;

    const currentSubtaskMessage = new HumanMessage(subtaskContext);

    // Invoke ACTION EXECUTOR (freeform output)
    const actionResponse = await actionExecutorAgent.invoke({
      messages: [...agentMessages, currentSubtaskMessage],
    });

    // Extract freeform execution summary from the last message
    const lastMessage =
      actionResponse.messages[actionResponse.messages.length - 1];
    const executionSummary =
      typeof lastMessage.content === "string" ?
        lastMessage.content
      : JSON.stringify(lastMessage.content);

    // Get current DOM state directly (avoid extra tool call in evaluator)
    let domRepresentation = "No DOM tree available";
    if (activeTabId) {
      const domService = sessionTabService.getDomService(activeTabId);
      domRepresentation =
        domService?.simplifiedDOMState?.flattenedDOM ?? "No DOM tree available";
    }

    // Build evaluation context
    let evaluationContext = "";

    // Add current subtask context
    evaluationContext += `## Current Subtask to Evaluate:\n${JSON.stringify(currentSubtask, null, 2)}\n\n`;

    // Add action-executor's execution summary
    evaluationContext += `## Action Executor Summary:\n${executionSummary}\n\n`;

    // Add current DOM state
    evaluationContext += `## Current DOM State:\n${domRepresentation}\n\n`;

    // Add context about previous subtasks (if any)
    if (i > 0) {
      const completedSubtasks = results.slice(0, i);
      evaluationContext += `## Previously Completed Subtasks:\n${JSON.stringify(completedSubtasks, null, 2)}\n\n`;
    }

    const evaluationMessage = new HumanMessage(evaluationContext);

    // Invoke EVALUATOR (structured output)
    const evaluationResponse = await evaluatorAgent.invoke({
      messages: [evaluationMessage],
    });

    // Update subtask status based on evaluator's structured response
    const updatedSubtask = {
      ...currentSubtask,
      status: (evaluationResponse.structuredResponse.is_task_successful ?
        "completed"
      : "failed") as "completed" | "failed",
      results: [
        ...(currentSubtask.results || []),
        evaluationResponse.structuredResponse.result_explanation,
      ],
    };
    results.push(updatedSubtask);

    // Accumulate messages for next subtask
    agentMessages = [...agentMessages, ...actionResponse.messages];

    // Trim messages to avoid bloat
    if (agentMessages.length > 50) {
      agentMessages = agentMessages.slice(-30);
    }

    // If subtask failed, stop and return to task-executor for replanning
    if (!evaluationResponse.structuredResponse.is_task_successful) {
      return new Command({
        update: {
          subtask_plan: {
            title: subtaskPlan.title,
            steps: [...results.slice(0, i), updatedSubtask],
          },
          current_subtask_index: i,
        },
        goto: "task-executor",
      });
    }
  }

  // ============================================================
  // ALL SUBTASKS COMPLETED - RETURN
  // ============================================================
  return new Command({
    update: {
      subtask_plan: {
        title: subtaskPlan.title,
        steps: results,
      },
      current_subtask_index: -1, // All done
    },
    goto: "task-executor",
  });
}
