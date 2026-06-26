import {
  stepCountIs,
  streamText,
  createUIMessageStream,
  type LanguageModel,
} from "ai";
import { complexModel } from "@agents/providers";
import { settingsService, SessionTabService } from "@/services";
import { sendAlert } from "@/utils/messageUtils";
import { TIMEOUTS, isTimeoutError } from "@agents/utils";
import log from "electron-log/main";
import { interactiveTools } from "@agents/tools/InteractiveTools";
import { navigationTools } from "@agents/tools/TabControlTools";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { askUserTool } from "@agents/tools/HitlAgentTool";
import { i18n } from "@/i18n";
import type { ModelMessage } from "ai";

const logger = log.scope("browser-use-simple-executor");

const SIMPLE_EXECUTOR_PROMPT = `# Role
Browser automation agent. Execute the user's request directly using browser tools. When done, summarize what you accomplished.

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
1. Before first action
2. After state-changing actions: clickElementTool, navigateTool, refreshTool, fillElementTool with submit=true
3. After 3+ actions without checking DOM
4. When uncertain about page state

## Skip getFlattenDOMTool:
1. After read-only actions: getElementAttributeTool, evaluateJavaScriptTool (reading), scrollPagesTool
2. If called within last 2 actions and page unchanged
3. If you already have the element's backendNodeId from previous action

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

1. Call getFlattenDOMTool to understand initial state
2. Note: "No DOM tree available" means no page loaded. Browser and tab are always available. Proceed normally.
3. Use backendNodeId from previous results when available
4. Execute actions sequentially
5. After each action: judge if it changed page state
   - Changed: Call getFlattenDOMTool
   - Unchanged: Skip getFlattenDOMTool
6. Continue until task complete or determined to fail

# User Interaction (askUser)
Use askUser when you need information, a decision, or hands-on help from the user to continue the task. Provide:
- request: what you need from the user (e.g., "Which shipping method?", "Login credentials needed")
- context: the current page state, relevant data/choices found on the page, and the overall task goal

The sub-agent will pick the best interaction format (text input, option list, multi-step flow, or manual browser intervention). Returns the user's response as free text.
Always try to complete as much as possible before asking (e.g., navigate to the login page first, then ask the user to log in).`;

export async function executeSimpleBrowserTask(
  messages: ModelMessage[],
  sessionId: string,
  chatLanguageModel: LanguageModel,
  signal?: AbortSignal,
): Promise<ReturnType<typeof createUIMessageStream>> {
  logger.debug("Starting simple browser task", { sessionId });

  const sessionTabService = SessionTabService.getInstance();
  const activeTabId = sessionTabService.getActiveTabForSession(sessionId);

  if (!activeTabId) {
    logger.error("No active tab found for session", { sessionId });
    throw new Error(
      "Cannot execute simple browser task: No active tab found for this session",
    );
  }

  return createUIMessageStream({
    execute: async ({ writer }) => {
      const result = streamText({
        model: complexModel(),
        messages,
        system: SIMPLE_EXECUTOR_PROMPT,
        tools: {
          getFlattenDOMTool,
          ...interactiveTools,
          ...navigationTools,
          askUser: askUserTool,
        },
        toolChoice: "auto",
        stopWhen: [stepCountIs(100)],
        maxRetries: settingsService.settings.maxRetries,
        timeout: TIMEOUTS.actionExecution,
        abortSignal: signal,
        experimental_telemetry: {
          isEnabled: settingsService.settings.langfuse.enabled,
          functionId: "browser-use-simple-executor",
          metadata: { sessionId },
        },
        experimental_context: {
          sessionId,
          activeTabId,
          chatModel: chatLanguageModel,
          writer,
          abortSignal: signal,
        },
      });

      // No filtered streaming needed — HITL tool calls are streamed
      // to the frontend by the askUser sub-agent itself.
      await result.text;

      logger.debug("Simple task completed", { sessionId });
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("Error in simple executor stream", {
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
          i18n.t("agents.browserUseErrorTitle"),
          i18n.t("agents.browserUseErrorBody", { error: msg }),
        );
      }
      return msg;
    },
  });
}
