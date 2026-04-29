import { stepCountIs, streamText, tool, createUIMessageStream } from "ai";
import { z } from "zod";
import { complexModel } from "@agents/providers";
import { settingsService } from "@/services";
import { SessionTabService } from "@/services";
import {
  writeSimulatedToolCallToStream,
  mergeStreamAndWait,
  createToolFilteredStream,
} from "@agents/utils";
import log from "electron-log/main";
import { interactiveTools } from "@agents/tools/InteractiveTools";
import { navigationTools } from "@agents/tools/TabControlTools";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { hitlTools } from "@agents/tools/HitlTools";
import type { UIPlanType, UIPlanTodo } from "./planner";
import { hasSuccessfulToolResult } from "@/agents/utils";

const logger = log.scope("browser-use-action-executor");

const MAX_STEPS_PER_SUBTASK = 30;

// ============================================================================
// System Prompts
// ============================================================================

const ACTION_EXECUTOR_PROMPT = `# Role
Browser automation action executor. Execute subtasks sequentially using browser tools.

# Available Tools
Interactive elements: click, fill, select, hover, drag
Page navigation: navigate, refresh, go back, go forward
Page scrolling: scroll by pages or at coordinates
DOM analysis: getFlattenDOMTool (flattened DOM representation)
Element inspection: get attributes, evaluate JavaScript, get basic info
Human intervention: requestHumanIntervention (ask user to handle operations you cannot automate)
User input: requestUserInput (ask the user a question and receive a text response)
Option selection: requestOptionList (present choices for the user to select from)

# Tab Context
Active tab is pre-selected. All interactive tools use this tab automatically. Do NOT specify tabId.
Note: If you see "No DOM tree available", it means no page is loaded yet. Browser and tab are still available - proceed with actions like navigate.

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

# FAILURE RULES — CRITICAL

You MUST call subtaskComplete(success: false) IMMEDIATELY when ANY of these occur:

## Hard Fail — Stop and report immediately:
1. The target element does not exist in the DOM after a fresh getFlattenDOMTool call
2. A navigation action results in an error page (404, 403, 500, connection refused, DNS error)
3. An unexpected redirect takes you to a completely different site than intended
4. The page shows a CAPTCHA, bot detection, or access denied message
5. A tool action returns an error (element not found, action failed, timeout)
6. The DOM structure does not match what the subtask expects (e.g., looking for a login form but the page shows a product listing)
7. The page does not provide functionality that you can use to accomplish given instruction.

## Pattern Fail — If the same problem persists after 3 attempts to achieve the same thing, either using the same or different methodology:
1. An element is found but clicking/filling it does not produce the expected result (after 3 tries)
2. The page state does not change after performing what should be a state-changing action (after 3 tries)
3. You cannot locate the expected UI component despite scrolling and DOM exploration (after 3 tries)
4. You cannot do the thing that you were asking for after 3 tries.

## When in doubt, FAIL. Do NOT:
- Keep trying variations of the same failed action
- Scroll endlessly looking for an element
- Repeatedly call getFlattenDOMTool hoping the page will change
- Spend more than 5 tool calls trying to accomplish a single action, e.g. entering info into a specific form field.

Failure is not bad — it triggers a recovery system that will replan a better approach. Failing fast is always better than wasting steps.

# Completion
When the subtask is done (goal achieved or determined impossible), you MUST call the subtaskComplete tool with:
- success: true if the subtask goal was achieved, false otherwise
- summary: a brief description of what was accomplished or why it failed. When reporting failure, describe: what you expected, what actually happened, and what you tried.

This is required to signal completion. Do not just describe the result in text.

# Human Intervention (requestHumanIntervention)
Use requestHumanIntervention when the user must physically perform an action in the browser that you cannot automate. This includes ALL sensitive operations:
- Login forms, credentials, passwords
- CAPTCHAs, 2FA, security challenges
- Payment forms, credit card entry
- Any operation requiring human judgment or private information

Parameters:
- reason: a short explanation of what intervention is needed
- instructions: what the user should do (e.g., "Please log in with your credentials")
- buttonLabel: context-appropriate text for the confirm button (e.g., "Login Complete", "CAPTCHA Solved", "Done")

The user will complete the action in the browser and confirm. Once confirmed, call getFlattenDOMTool to see the updated page state, then continue with the task.
Always try to complete as much as possible before requesting intervention (e.g., navigate to the login page first, then ask the user to log in).

# User Input (requestUserInput)
Use requestUserInput to ask the user a question and receive a text answer. This is ONLY for non-sensitive information needed to complete the current task:
- Search queries (e.g., "What would you like to search for?")
- Preferences (e.g., "Which color scheme do you prefer?")
- Clarification on ambiguous instructions (e.g., "Which shipping option should I select?")
- Non-sensitive values to enter (e.g., "What name should I use for the account?")

Parameters:
- question: the question you need answered
- context: why you need this information
- placeholder: optional example text for the input field
- buttonLabel: context-appropriate text for the submit button (e.g., "Search", "Confirm", "Submit")

NEVER use requestUserInput to ask for passwords, payment details, or other sensitive information. Use requestHumanIntervention instead to let the user enter those directly in the browser.
The user will type their response and submit it. Use the returned answer to continue the task.

# Option List (requestOptionList)
Use requestOptionList when the user needs to choose from a known, finite set of options. Ideal when the valid choices are enumerable:
- Selection between alternatives (e.g., "Which shipping method?", "Which color?")
- Picking from discovered results (e.g., "Which of these products to view?")
- Configuration choices (e.g., "Which date format?", "Which layout?")
- Disambiguation (e.g., "Which 'John Smith' do you mean?")

Parameters:
- prompt: a clear question describing what the user is choosing
- options: array of choices, each with id, label, and optional description. Use at most 8 options for readability.
- selectionMode: "single" (default) or "multi" for allowing multiple selections
- minSelections / maxSelections: constraints on multi-select (optional)
- defaultValue: pre-selected option ID(s) (optional)

Prefer requestOptionList over requestUserInput when the valid answers form a small, known set (typically 2-8 options) and you can enumerate the choices (e.g., options found on the current page).
Prefer requestUserInput when the answer is open-ended text or you don't know the possible answers in advance.
NEVER use requestOptionList for sensitive information. Use requestHumanIntervention instead.
The user will select option(s) and confirm. Use the returned selection IDs to continue the task.`;

// ============================================================================
// Helper Functions
// ============================================================================

function buildSubtaskContext(
  subtask: UIPlanTodo,
  previousSubtasks: UIPlanTodo[],
): string {
  let context = "";

  if (previousSubtasks.length > 0) {
    const completedSubtasks = previousSubtasks.filter(
      (s) => s.status === "completed",
    );
    if (completedSubtasks.length > 0) {
      context += `## Previously Completed Subtasks:\n${JSON.stringify(completedSubtasks, null, 2)}\n\n`;
    }
  }

  context += `## Current Subtask to Execute:\n${JSON.stringify(subtask, null, 2)}`;

  return context;
}

// ============================================================================
// Main Execution Function
// ============================================================================

export async function executeSubtasks(
  subtaskPlan: UIPlanType,
  sessionId: string,
  subtaskPlanToolCallId: string,
): Promise<ReturnType<typeof createUIMessageStream>> {
  logger.debug("Starting subtask execution stream", {
    sessionId,
    subtaskCount: subtaskPlan.todos.length,
  });

  const sessionTabService = SessionTabService.getInstance();
  const activeTabId = sessionTabService.getActiveTabForSession(sessionId);

  if (!activeTabId) {
    logger.error("No active tab found for session", { sessionId });
    throw new Error(
      "Cannot execute subtasks: No active tab found for this session",
    );
  }

  return createUIMessageStream({
    execute: async ({ writer }) => {
      let allSuccessful = true;

      for (let i = 0; i < subtaskPlan.todos.length; i++) {
        const subtask = subtaskPlan.todos[i];
        const completedSubtasks = subtaskPlan.todos.slice(0, i);

        logger.debug("Executing subtask", {
          subtaskId: subtask.id,
          subtaskLabel: subtask.label,
          index: i,
        });

        try {
          // Mark subtask as in_progress and update UI
          subtask.status = "in_progress";
          writeSimulatedToolCallToStream({
            writer,
            toolCallId: subtaskPlanToolCallId,
            toolName: "plan",
            input: {
              title: subtaskPlan.title,
              todos: subtaskPlan.todos,
            },
            output: subtaskPlan,
          });

          const subtaskContext = buildSubtaskContext(
            subtask,
            completedSubtasks,
          );

          const result = streamText({
            model: complexModel(),
            messages: [{ role: "user", content: subtaskContext }],
            system: ACTION_EXECUTOR_PROMPT,
            tools: {
              getFlattenDOMTool,
              ...interactiveTools,
              ...navigationTools,
              ...hitlTools,
              subtaskComplete: tool({
                description:
                  "Signal that the current subtask has been completed. Call this when you have accomplished the subtask goal or determined it cannot be completed. YOU MUST CALL THIS TOOL when finished to signal completion.",
                inputSchema: z.object({
                  success: z
                    .boolean()
                    .describe("Whether the subtask was successful"),
                  summary: z
                    .string()
                    .describe(
                      "Summary of what was accomplished or why it failed",
                    ),
                }),
                execute: async ({ success, summary }) => ({
                  success,
                  summary,
                }),
              }),
            },
            toolChoice: "auto",
            stopWhen: [
              hasSuccessfulToolResult("subtaskComplete"),
              stepCountIs(MAX_STEPS_PER_SUBTASK),
            ],
            experimental_telemetry: {
              isEnabled: settingsService.settings.langfuse.enabled,
              functionId: "browser-use-action-executor",
              metadata: {
                sessionId,
                subtaskId: subtask.id,
                subtaskLabel: subtask.label,
                subtaskIndex: i,
              },
            },
            experimental_context: {
              sessionId,
              activeTabId,
            },
          });

          // Stream HITL tool calls to frontend & extract results
          const HITL_TOOLS = new Set([
            "requestHumanIntervention",
            "requestUserInput",
            "requestOptionList",
          ]);
          const [steps] = await Promise.all([
            result.steps,
            mergeStreamAndWait(
              createToolFilteredStream(
                result.toUIMessageStream({ sendStart: false }),
                HITL_TOOLS,
              ),
              writer,
            ),
          ]);
          const allToolResults = steps.flatMap(
            (step) => step.toolResults ?? [],
          );
          const completeResult = allToolResults.find(
            (toolResult) => toolResult.toolName === "subtaskComplete",
          );

          // Determine success/summary: if subtaskComplete was called, use its
          // output. Otherwise the step limit was reached — treat as failure.
          let success: boolean;
          let summary: string;

          if (completeResult) {
            const output = completeResult.output as {
              success: boolean;
              summary: string;
            };
            success = output.success;
            summary = output.summary;
          } else {
            logger.warn(
              "Step limit reached without subtaskComplete, treating as failure",
              { subtaskId: subtask.id },
            );
            success = false;
            summary = `Step limit (${MAX_STEPS_PER_SUBTASK}) reached without completing the subtask. The agent did not signal completion.`;
          }

          logger.debug("Subtask completed", {
            subtaskId: subtask.id,
            success,
            summary,
          });

          // Update subtask status in-place
          subtask.status = success ? "completed" : "cancelled";

          subtaskPlan.receipt = {
            outcome: success ? "success" : "cancelled",
            summary,
            at: new Date().toISOString(),
          };

          // Stream the subtask status to the frontend
          writeSimulatedToolCallToStream({
            writer,
            toolCallId: subtaskPlanToolCallId,
            toolName: "plan",
            input: {
              title: subtaskPlan.title,
              todos: subtaskPlan.todos,
            },
            output: subtaskPlan,
          });

          if (!success) {
            logger.info("Subtask failed, stopping execution", {
              subtaskId: subtask.id,
              subtaskLabel: subtask.label,
              summary,
            });
            allSuccessful = false;
            break;
          }
        } catch (error) {
          logger.error("Subtask execution error", {
            subtaskId: subtask.id,
            subtaskLabel: subtask.label,
            error,
          });

          subtask.status = "cancelled";
          subtaskPlan.receipt = {
            outcome: "cancelled",
            summary: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString(),
          };

          allSuccessful = false;
          break;
        }
      }

      if (allSuccessful) {
        logger.info("All subtasks completed successfully", {
          totalSubtasks: subtaskPlan.todos.length,
        });
      } else {
        logger.info("Some subtasks failed", {
          totalSubtasks: subtaskPlan.todos.length,
          failedCount: subtaskPlan.todos.filter((t) => t.status === "cancelled")
            .length,
        });
      }
    },
    onError: (error) => {
      logger.error("Error in action executor stream", {
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return error instanceof Error ? error.message : String(error);
    },
  });
}
