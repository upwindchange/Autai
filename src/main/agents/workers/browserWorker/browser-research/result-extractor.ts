import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { createIdGenerator } from "@ai-sdk/provider-utils";
import { complexModel } from "@agents/providers";
import {
  hasSuccessfulToolResult,
  writeSimulatedToolCallToStream,
} from "@agents/utils";
import { navigateTool } from "@agents/tools/TabControlTools";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { settingsService, SessionTabService } from "@/services";
import { i18n } from "@/i18n";
import type { SearchResultItem } from "./search-agent";
import type { ResearchQuery } from "./planner";
import log from "electron-log/main";

const logger = log.scope("research-result-extractor");
const generateId = createIdGenerator({ prefix: "call", size: 24 });

// ===== Result Types =====

export interface ExtractionResult {
  url: string;
  title: string;
  summary: string;
  quotes: string[];
  relevant: boolean;
}

// ===== Schema =====

const extractionResultSchema = z.object({
  url: z.string().describe("The source URL"),
  summary: z
    .string()
    .describe("Concise summary of the relevant information found"),
  quotes: z
    .array(z.string())
    .max(5)
    .describe(
      "Key verbatim quotes from the original text supporting the answer (up to 5)",
    ),
  relevant: z
    .boolean()
    .describe("Whether this page contained relevant information"),
});

// ===== Tool =====

const showExtractionResultTool = tool({
  description: "Return the extraction result from the web page",
  inputSchema: extractionResultSchema,
  execute: async (input) => {
    return input;
  },
});

// ===== System Prompt =====

const extractionPrompt = `You are a web content analyst. Extract relevant information from a web page to answer a research question.

## Your Task
Analyze the page content provided in the DOM and extract information relevant to the research focus.

## Instructions
1. Analyze the page content in the DOM
2. Extract information relevant to the research focus
3. Provide:
   - A concise summary of the relevant information found
   - Up to 5 key verbatim quotes from the original text that support the answer
   - Whether the page was actually relevant to the research focus

## Guidelines
- Focus only on information relevant to the research question
- Quotes should be exact text from the page, not paraphrased
- If the page is not relevant (e.g., paywall, error page, unrelated content), set relevant=false
- Summarize in a way that will be useful for composing a final answer
- Skip navigation menus, footers, ads, and boilerplate content
- If the page requires login or shows a consent form, set relevant=false

## Output
Call showExtractionResult with your analysis.`;

// ===== Helper: Direct tool execution with context =====

async function navigateTo(
  url: string,
  sessionId: string,
  activeTabId: string,
): Promise<void> {
  await navigateTool.execute!(
    { url },
    {
      toolCallId: generateId(),
      messages: [],
      experimental_context: { sessionId, activeTabId },
    },
  );
}

async function getFlattenDOM(
  sessionId: string,
  activeTabId: string,
): Promise<string> {
  const result = await getFlattenDOMTool.execute!(
    {},
    {
      toolCallId: generateId(),
      messages: [],
      experimental_context: { sessionId, activeTabId },
    },
  );
  return (result as { representation: string }).representation;
}

// ===== Single Extraction =====

async function executeSingleExtraction(
  searchResult: SearchResultItem,
  focusDescription: string,
  sessionId: string,
  tabId: string,
  sessionTabService: SessionTabService,
): Promise<ExtractionResult> {
  logger.debug("Extracting from URL", {
    url: searchResult.url,
    title: searchResult.title,
  });

  try {
    await navigateTo(searchResult.url, sessionId, tabId);

    // Set this tab as active and visible
    const state = sessionTabService.getSessionTabState(sessionId);
    if (state) state.activeTabId = tabId;
    await sessionTabService.setBackendVisibility(tabId, true);

    const domRepresentation = await getFlattenDOM(sessionId, tabId);

    const truncatedDom =
      domRepresentation.length > 60000 ?
        domRepresentation.slice(0, 60000) + "\n\n[... content truncated ...]"
      : domRepresentation;

    logger.debug("DOM received for extraction", {
      url: searchResult.url,
      domLength: domRepresentation.length,
      truncatedLength: truncatedDom.length,
    });

    const extractionResult = streamText({
      model: complexModel(),
      messages: [
        {
          role: "user",
          content: `Research focus: "${focusDescription}"\nSource URL: ${searchResult.url}\nSource title: ${searchResult.title}\n\nPage DOM:\n${truncatedDom}`,
        },
      ],
      system: extractionPrompt,
      tools: {
        showExtractionResult: showExtractionResultTool,
      },
      toolChoice: {
        type: "tool",
        toolName: "showExtractionResult",
      },
      stopWhen: [
        hasSuccessfulToolResult("showExtractionResult"),
        stepCountIs(10),
      ],
      experimental_telemetry: {
        isEnabled: settingsService.settings.langfuse.enabled,
        functionId: "research-result-extraction",
        metadata: {
          url: searchResult.url,
        },
      },
    });

    const steps = await extractionResult.steps;
    const toolResult = steps
      .flatMap((s) => s.toolResults ?? [])
      .find(
        (tr) =>
          tr.toolName === "showExtractionResult" && tr.type === "tool-result",
      );

    if (toolResult) {
      const output = toolResult.output as ExtractionResult;
      logger.debug("Extraction complete", {
        url: searchResult.url,
        relevant: output.relevant,
      });
      return {
        ...output,
        title: searchResult.title,
      };
    }

    logger.warn("No extraction result for URL", {
      url: searchResult.url,
      stepCount: steps.length,
      stepTypes: steps
        .flatMap((s) => s.toolResults ?? [])
        .map((tr) => ({
          toolName: tr.toolName,
          type: tr.type,
        })),
    });

    return {
      url: searchResult.url,
      title: searchResult.title,
      summary: i18n.t("agents.extractionLlmFailed"),
      quotes: [],
      relevant: false,
    };
  } catch (error) {
    logger.error("Extraction failed for URL", {
      url: searchResult.url,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      url: searchResult.url,
      title: searchResult.title,
      summary: i18n.t("agents.extractionFailed", {
              error: error instanceof Error ? error.message : String(error),
            }),
      quotes: [],
      relevant: false,
    };
  }
}

// ===== Main Exported Function =====

export async function extractResultsFromUrls(
  searchResults: SearchResultItem[],
  researchFocus: ResearchQuery[],
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writer: { write: (chunk: any) => void },
): Promise<ExtractionResult[]> {
  const sessionTabService = SessionTabService.getInstance();
  const focusDescription = researchFocus.map((q) => q.focus).join("; ");
  const extractionPlanId = `research-extraction-${sessionId}`;

  // Destroy all existing session tabs
  await sessionTabService.destroyAllTabs(sessionId);

  // Create one tab per search result
  for (let i = 0; i < searchResults.length; i++) {
    await sessionTabService.createTab({ sessionId });
  }
  const tabIds = sessionTabService.getTabsForSession(sessionId);

  try {
    // Emit progress: all extractions "in_progress"
    writeSimulatedToolCallToStream({
      writer,
      toolCallId: extractionPlanId,
      toolName: "plan",
      input: {
        title: i18n.t("agents.extractingTitle"),
        description: i18n.t("agents.extractingDescription"),
        todos: searchResults.map((sr, idx) => ({
          id: `research-extract-${sessionId}-${idx}`,
          label: i18n.t("agents.readLabel", { title: sr.title }),
          status: "in_progress" as const,
          description: sr.url,
        })),
      },
      output: {
        id: extractionPlanId,
        title: i18n.t("agents.extractingTitle"),
        description: i18n.t("agents.extractingDescription"),
        todos: searchResults.map((sr, idx) => ({
          id: `research-extract-${sessionId}-${idx}`,
          label: i18n.t("agents.readLabel", { title: sr.title }),
          status: "in_progress" as const,
          description: sr.url,
        })),
      },
    });

    // Run all extractions in parallel
    const settledResults = await Promise.allSettled(
      tabIds.map((tabId, i) =>
        executeSingleExtraction(
          searchResults[i],
          focusDescription,
          sessionId,
          tabId,
          sessionTabService,
        ),
      ),
    );

    // Collect results
    const allExtractions: ExtractionResult[] = [];
    for (let i = 0; i < settledResults.length; i++) {
      const result = settledResults[i];
      if (result.status === "fulfilled") {
        allExtractions.push(result.value);
      } else {
        logger.error("Parallel extraction failed", {
          url: searchResults[i].url,
          error:
            result.reason instanceof Error ?
              result.reason.message
            : String(result.reason),
        });
        allExtractions.push({
          url: searchResults[i].url,
          title: searchResults[i].title,
          summary: i18n.t("agents.extractionGenericFailed", {
              error:
                result.reason instanceof Error ?
                  result.reason.message
                : String(result.reason),
            }),
          quotes: [],
          relevant: false,
        });
      }
    }

    // Emit progress: all extractions "completed"
    writeSimulatedToolCallToStream({
      writer,
      toolCallId: extractionPlanId,
      toolName: "plan",
      input: {
        title: i18n.t("agents.extractingTitle"),
        description: i18n.t("agents.extractingDescription"),
        todos: searchResults.map((sr, idx) => ({
          id: `research-extract-${sessionId}-${idx}`,
          label: i18n.t("agents.readLabel", { title: sr.title }),
          status: "completed" as const,
          description: sr.url,
        })),
      },
      output: {
        id: extractionPlanId,
        title: i18n.t("agents.extractingTitle"),
        description: i18n.t("agents.extractingDescription"),
        todos: searchResults.map((sr, idx) => ({
          id: `research-extract-${sessionId}-${idx}`,
          label: i18n.t("agents.readLabel", { title: sr.title }),
          status: "completed" as const,
          description: sr.url,
        })),
      },
    });

    return allExtractions;
  } finally {
    // Destroy ALL tabs
    await sessionTabService.destroyAllTabs(sessionId);
  }
}
