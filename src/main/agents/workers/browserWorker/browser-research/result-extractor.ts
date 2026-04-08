import {
  streamText,
  createUIMessageStream,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";
import { createIdGenerator } from "@ai-sdk/provider-utils";
import { complexModel } from "@agents/providers";
import {
  mergeStreamAndWait,
  hasSuccessfulToolResult,
  writeSimulatedToolCallToStream,
} from "@agents/utils";
import { navigateTool } from "@agents/tools/TabControlTools";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { settingsService } from "@/services";
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

// ===== Main Exported Function =====

export async function extractResultsFromUrls(
  searchResults: SearchResultItem[],
  researchFocus: ResearchQuery[],
  sessionId: string,
  activeTabId: string,
): Promise<{
  stream: ReturnType<typeof createUIMessageStream>;
  results: Promise<ExtractionResult[]>;
}> {
  const allExtractions: ExtractionResult[] = [];
  let resolveResults: (results: ExtractionResult[]) => void;
  const resultsPromise = new Promise<ExtractionResult[]>((resolve) => {
    resolveResults = resolve;
  });
  const focusDescription = researchFocus.map((q) => q.focus).join("; ");

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      try {
        for (let i = 0; i < searchResults.length; i++) {
          const searchResult = searchResults[i];

          logger.debug("Extracting from URL", {
            url: searchResult.url,
            title: searchResult.title,
          });

          // Show UI progress
          writeSimulatedToolCallToStream({
            writer,
            toolCallId: generateId(),
            toolName: "plan",
            input: {
              title: `Reading: ${searchResult.title}`,
              description: searchResult.url,
            },
            output: {
              id: `extraction-${sessionId}`,
              title: "Extracting Results",
              description: "Reading and analyzing web pages",
              todos: searchResults.map((sr, idx) => ({
                id: `extract-${sessionId}-${idx}`,
                label: `Read: ${sr.title}`,
                status:
                  idx < i ? "completed"
                  : idx === i ? "in_progress"
                  : "pending",
                description: sr.url,
              })),
            },
          });

          try {
            // Navigate to the URL
            await navigateTo(searchResult.url, sessionId, activeTabId);

            // Get the DOM
            const domRepresentation = await getFlattenDOM(
              sessionId,
              activeTabId,
            );

            // Truncate if too large (60k chars for content pages)
            const truncatedDom =
              domRepresentation.length > 60000 ?
                domRepresentation.slice(0, 60000) +
                "\n\n[... content truncated ...]"
              : domRepresentation;

            // Extract with LLM
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
                  urlIndex: i,
                  url: searchResult.url,
                },
              },
            });

            // Merge extraction stream
            await mergeStreamAndWait(
              extractionResult.toUIMessageStream({ sendStart: false }),
              writer,
            );

            // Extract result
            const steps = await extractionResult.steps;
            const toolResult = steps
              .flatMap((s) => s.toolResults ?? [])
              .find(
                (tr) =>
                  tr.toolName === "showExtractionResult" &&
                  tr.type === "tool-result",
              );

            if (toolResult) {
              const output = toolResult.output as ExtractionResult;
              allExtractions.push({
                ...output,
                title: searchResult.title,
              });

              logger.debug("Extraction complete", {
                url: searchResult.url,
                relevant: output.relevant,
              });
            } else {
              logger.warn("No extraction result for URL", {
                url: searchResult.url,
              });
            }
          } catch (error) {
            logger.error("Extraction failed for URL", {
              url: searchResult.url,
              error: error instanceof Error ? error.message : String(error),
            });

            allExtractions.push({
              url: searchResult.url,
              title: searchResult.title,
              summary: `Failed to extract content: ${error instanceof Error ? error.message : String(error)}`,
              quotes: [],
              relevant: false,
            });
          }
        }
      } finally {
        resolveResults!([...allExtractions]);
      }
    },
    onError: (error) => {
      logger.error("Error in result extraction stream", {
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return error instanceof Error ? error.message : String(error);
    },
  });

  return {
    stream,
    results: resultsPromise,
  };
}
