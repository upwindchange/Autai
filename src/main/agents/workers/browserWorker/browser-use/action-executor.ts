import { stepCountIs, streamText, tool, createUIMessageStream } from "ai";
import { z } from "zod";
import { complexModel } from "@agents/providers";
import { settingsService } from "@/services";
import { SessionTabService } from "@/services";
import { i18n } from "@/i18n";
import { sendAlert } from "@/utils/messageUtils";
import {
  writeSimulatedToolCallToStream,
  TIMEOUTS,
  isTimeoutError,
} from "@agents/utils";
import log from "electron-log/main";
import { interactiveTools } from "@agents/tools/InteractiveTools";
import { navigationTools } from "@agents/tools/TabControlTools";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { askUserTool } from "@agents/tools/HitlAgentTool";
import type { UIPlanType, UIPlanTodo } from "./planner";
import { hasSuccessfulToolResult } from "@/agents/utils";

const logger = log.scope("browser-use-action-executor");

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
User interaction: askUser (ask the user for information, a decision, or hands-on help)

# Tab Context
Active tab is pre-selected. All interactive tools use this tab automatically. Do NOT specify tabId.
Note: If you see "No DOM tree available", it means no page is loaded yet. Browser and tab are still available - proceed with actions like navigate.

# DOM State Management Rules

## Call getFlattenDOMTool:
1. First action of each task
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

# Completion
When the subtask is done (goal achieved or determined impossible), you MUST call the subtaskComplete tool with:
- success: true if the subtask goal was achieved, false otherwise
- summary: a brief description of what was accomplished or why it failed

This is required to signal completion. Do not just describe the result in text.

# User Interaction (askUser)
Use askUser when you need information, a decision, or hands-on help from the user to continue the task. Provide:
- request: what you need from the user (e.g., "Which shipping method?", "Login credentials needed")
- context: the current page state, relevant data/choices found on the page, and the overall task goal

The sub-agent will pick the best interaction format (text input, option list, multi-step flow, or manual browser intervention). Returns the user's response as free text.
Always try to complete as much as possible before asking (e.g., navigate to the login page first, then ask the user to log in).`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build context for action executor
 */
function buildSubtaskContext(
  subtask: UIPlanTodo,
  previousSubtasks: UIPlanTodo[],
): string {
  let context = "";

  // Add previously completed tasks
  if (previousSubtasks.length > 0) {
    const completedSubtasks = previousSubtasks.filter(
      (s) => s.status === "completed",
    );
    if (completedSubtasks.length > 0) {
      context += `## Previously Completed Tasks:\n${JSON.stringify(completedSubtasks, null, 2)}\n\n`;
    }
  }

  // Add current task
  context += `## Current Task to Execute:\n${JSON.stringify(subtask, null, 2)}`;

  return context;
}

// ============================================================================
// Main Execution Function
// ============================================================================

/**
 * Execute subtasks sequentially using streamText
 *
 * Modifies plan in-place - no need to return it.
 * Returns a StreamTextResult that streams all subtask executions.
 *
 * @param plan - The subtask plan to execute (modified in-place)
 * @param sessionId - The current session ID
 * @param planToolCallId - The toolCallId from the planner's plan tool call, used to update the plan UI in-place
 * @returns StreamTextResult that streams all subtask executions
 */
export async function executeSubtasks(
  plan: UIPlanType,
  sessionId: string,
  planToolCallId: string,
): Promise<ReturnType<typeof createUIMessageStream>> {
  logger.debug("Starting subtask execution stream", {
    sessionId,
    subtaskCount: plan.todos.length,
  });

  // ============================================================
  // SETUP CONTEXT (zero-token passing)
  // ============================================================
  const sessionTabService = SessionTabService.getInstance();
  const activeTabId = sessionTabService.getActiveTabForSession(sessionId);

  // Assert that an active tab exists
  if (!activeTabId) {
    logger.error("No active tab found for session", {
      sessionId,
    });
    throw new Error(
      "Cannot execute subtasks: No active tab found for this session",
    );
  }

  // ============================================================
  // CREATE STREAM THAT EXECUTES SUBTASKS SEQUENTIALLY
  // ============================================================
  return createUIMessageStream({
    execute: async ({ writer }) => {
      let allSuccessful = true;

      // ============================================================
      // EXECUTE SUBTASKS SEQUENTIALLY
      // ============================================================
      for (let i = 0; i < plan.todos.length; i++) {
        const subtask = plan.todos[i];
        const completedSubtasks = plan.todos.slice(0, i);

        logger.debug("Executing subtask", {
          subtaskId: subtask.id,
          subtaskLabel: subtask.label,
          index: i,
        });

        try {
          // ============================================================
          // MARK SUBTASK AS IN_PROGRESS AND UPDATE UI
          // ============================================================
          subtask.status = "in_progress";
          writeSimulatedToolCallToStream({
            writer,
            toolCallId: planToolCallId,
            toolName: "plan",
            input: {
              title: plan.title,
              todos: plan.todos,
            },
            output: plan,
          });

          // ============================================================
          // BUILD CONTEXT FOR THIS SUBTASK
          // ============================================================
          const subtaskContext = buildSubtaskContext(
            subtask,
            completedSubtasks,
          );

          // ============================================================
          // EXECUTE ACTIONS FOR THIS SUBTASK USING streamText
          // ============================================================
          const result = streamText({
            model: complexModel(),
            messages: [{ role: "user", content: subtaskContext }],
            system: ACTION_EXECUTOR_PROMPT,
            tools: {
              getFlattenDOMTool,
              ...interactiveTools,
              ...navigationTools,
              askUser: askUserTool,
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
              stepCountIs(100),
            ],
            timeout: TIMEOUTS.actionExecution,
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
              writer,
            },
          });

          // ============================================================
          // EXTRACT RESULTS — no streaming needed here
          // ============================================================
          // HITL tool calls are streamed to the frontend by the askUser
          // sub-agent itself. We only need the steps to find the
          // subtaskComplete result.
          const steps = await result.steps;
          const allToolResults = steps.flatMap(
            (step) => step.toolResults ?? [],
          );
          const completeResult = allToolResults.find(
            (toolResult) => toolResult.toolName === "subtaskComplete",
          );

          if (!completeResult) {
            logger.error("Agent did not call subtaskComplete tool", {
              subtaskId: subtask.id,
              toolResults: allToolResults,
            });
            throw new Error(
              "Agent failed to complete subtask: subtaskComplete tool not called",
            );
          }

          const { success, summary } = completeResult.output as {
            success: boolean;
            summary: string;
          };

          logger.debug("Subtask completed", {
            subtaskId: subtask.id,
            success,
            summary,
          });

          // ============================================================
          // UPDATE SUBTASK STATUS IN-PLACE
          // ============================================================
          subtask.status = success ? "completed" : "cancelled";

          // Populate receipt with completion result for task executor
          plan.receipt = {
            outcome: success ? "success" : "cancelled",
            summary,
            at: new Date().toISOString(),
          };

          // Stream the subtask status to the frontend
          writeSimulatedToolCallToStream({
            writer,
            toolCallId: planToolCallId,
            toolName: "plan",
            input: {
              title: plan.title,
              todos: plan.todos,
            },
            output: plan,
          });

          logger.debug("Simulated plan tool call for subtask status", {
            subtaskId: subtask.id,
            status: subtask.status,
          });

          // ============================================================
          // STOP IF SUBTASK FAILED
          // ============================================================
          if (!success) {
            logger.info("Subtask failed, stopping execution", {
              subtaskId: subtask.id,
              subtaskLabel: subtask.label,
              summary,
            });
            allSuccessful = false;
            break; // Stop processing more subtasks
          }
        } catch (error) {
          // ============================================================
          // ERROR HANDLING
          // ============================================================
          const msg = error instanceof Error ? error.message : String(error);
          logger.error("Subtask execution error", {
            subtaskId: subtask.id,
            subtaskLabel: subtask.label,
            error,
          });

          if (isTimeoutError(error)) {
            sendAlert(
              i18n.t("agents.timeoutErrorTitle"),
              i18n.t("agents.timeoutErrorBody"),
            );
          } else {
            sendAlert(
              i18n.t("agents.actionErrorTitle"),
              i18n.t("agents.actionErrorBody", {
                label: subtask.label,
                error: msg,
              }),
            );
          }

          // Mark subtask as cancelled
          subtask.status = "cancelled";

          allSuccessful = false;
          break; // Stop processing more subtasks
        }
      }

      // ============================================================
      // ALL SUBTASKS COMPLETED (OR FAILED)
      // ============================================================
      if (allSuccessful) {
        logger.info("All subtasks completed successfully", {
          totalSubtasks: plan.todos.length,
        });
      } else {
        logger.info("Some subtasks failed", {
          totalSubtasks: plan.todos.length,
          failedCount: plan.todos.filter((t) => t.status === "cancelled")
            .length,
        });
      }
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("Error in action executor stream", {
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (isTimeoutError(error)) {
        sendAlert(
          i18n.t("agents.timeoutErrorTitle"),
          i18n.t("agents.timeoutErrorBody"),
        );
      } else {
        sendAlert(
          i18n.t("agents.actionErrorTitle"),
          i18n.t("agents.actionErrorBody", { label: "unknown", error: msg }),
        );
      }
      return msg;
    },
  });
}
