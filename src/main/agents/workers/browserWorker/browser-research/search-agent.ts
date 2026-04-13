import { streamText, createUIMessageStream, stepCountIs, tool } from "ai";
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
import type { ResearchPlan } from "./planner";
import log from "electron-log/main";

const logger = log.scope("research-search-agent");
const generateId = createIdGenerator({ prefix: "call", size: 24 });

// ===== Result Types =====

export interface SearchResultItem {
  url: string;
  title: string;
  snippet: string;
  relevanceScore: number;
  queryIndex: number;
}

// ===== Schema =====

const searchResultItemSchema = z.object({
  url: z.string().describe("The URL of the search result"),
  title: z.string().describe("Title of the search result"),
  snippet: z
    .string()
    .describe("Brief snippet/description from the search result"),
  relevanceScore: z
    .number()
    .min(1)
    .max(10)
    .describe("How relevant this result is to the query (1-10)"),
});

const searchResultsSchema = z.object({
  results: z
    .array(searchResultItemSchema)
    .min(1)
    .max(5)
    .describe("The most relevant search results found (up to 5)"),
});

// ===== Tool =====

const showSearchResultsTool = tool({
  description: "Return the analyzed search results from the Google page",
  inputSchema: searchResultsSchema,
  execute: async (input) => {
    return input;
  },
});

// ===== System Prompt =====

const searchAnalysisPrompt = `You are a web search analyst. You are viewing the flattened DOM of a Google search results page.

## Your Task
Analyze the search results displayed in the DOM and identify the most relevant URLs.

## Instructions
1. Look at the search results in the DOM
2. Identify the most relevant results based on:
   - Title relevance to the search query
   - Snippet/content relevance to the focus area
   - Source authority (prefer official docs, well-known sites)
3. Select up to 5 of the most relevant results
4. For each result, extract: URL, title, snippet, and rate relevance (1-10)
5. Skip ads, sponsored results, and navigation links
6. Focus on organic search results only
7. Only include results from the first page of Google results

## Important
- Look for anchor (<a>) elements with href attributes pointing to external URLs
- Google search result URLs are typically in href attributes
- Skip Google's own navigation (Images, Videos, News tabs, etc.)
- Exclude PDF links unless specifically relevant
- Call showSearchResults with your analysis`;

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

// ===== Dedup =====

function deduplicateResults(
  results: SearchResultItem[],
  maxResults: number = 8,
): SearchResultItem[] {
  const seen = new Map<string, SearchResultItem>();

  for (const result of results) {
    try {
      const urlObj = new URL(result.url);
      const key = urlObj.origin + urlObj.pathname;
      const existing = seen.get(key);
      if (!existing || existing.relevanceScore < result.relevanceScore) {
        seen.set(key, result);
      }
    } catch {
      // Invalid URL, skip
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxResults);
}

// ===== Main Exported Function =====

export async function executeSearchQueries(
  plan: ResearchPlan,
  sessionId: string,
  activeTabId: string,
): Promise<{
  stream: ReturnType<typeof createUIMessageStream>;
  results: Promise<SearchResultItem[]>;
}> {
  const allResults: SearchResultItem[] = [];
  let resolveResults: (results: SearchResultItem[]) => void;
  const resultsPromise = new Promise<SearchResultItem[]>((resolve) => {
    resolveResults = resolve;
  });

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      try {
        for (let i = 0; i < plan.queries.length; i++) {
          const { query, focus } = plan.queries[i];
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

          logger.debug("Searching", { query, searchUrl });

          // Show UI progress
          writeSimulatedToolCallToStream({
            writer,
            toolCallId: generateId(),
            toolName: "plan",
            input: {
              title: `Searching: "${query}"`,
              description: `Query ${i + 1} of ${plan.queries.length}`,
            },
            output: {
              id: `search-${sessionId}`,
              title: plan.title,
              description: plan.description,
              todos: plan.queries.map((q, idx) => ({
                id: `search-${sessionId}-${idx}`,
                label: `Search: "${q.query}"`,
                status:
                  idx < i ? "completed"
                  : idx === i ? "in_progress"
                  : "pending",
                description: q.focus,
              })),
            },
          });

          try {
            // Navigate to Google
            await navigateTo(searchUrl, sessionId, activeTabId);

            // Get the DOM
            const domRepresentation = await getFlattenDOM(
              sessionId,
              activeTabId,
            );

            // Truncate if too large (50k chars)
            const truncatedDom =
              domRepresentation.length > 50000 ?
                domRepresentation.slice(0, 50000) +
                "\n\n[... content truncated ...]"
              : domRepresentation;

            // Analyze with LLM
            const analysisResult = streamText({
              model: complexModel(),
              messages: [
                {
                  role: "user",
                  content: `Search query: "${query}"\nFocus: "${focus}"\n\nGoogle search results DOM:\n${truncatedDom}`,
                },
              ],
              system: searchAnalysisPrompt,
              tools: {
                showSearchResults: showSearchResultsTool,
              },
              toolChoice: {
                type: "tool",
                toolName: "showSearchResults",
              },
              stopWhen: [
                hasSuccessfulToolResult("showSearchResults"),
                stepCountIs(10),
              ],
              experimental_telemetry: {
                isEnabled: settingsService.settings.langfuse.enabled,
                functionId: "research-search-analysis",
                metadata: {
                  queryIndex: i,
                  query,
                },
              },
            });

            // Merge analysis stream
            await mergeStreamAndWait(
              analysisResult.toUIMessageStream({ sendStart: false }),
              writer,
            );

            // Extract results
            const steps = await analysisResult.steps;
            const toolResult = steps
              .flatMap((s) => s.toolResults ?? [])
              .find(
                (tr) =>
                  tr.toolName === "showSearchResults" &&
                  tr.type === "tool-result",
              );

            if (toolResult) {
              const output = toolResult.output as {
                results: Array<{
                  url: string;
                  title: string;
                  snippet: string;
                  relevanceScore: number;
                }>;
              };

              for (const r of output.results) {
                allResults.push({
                  ...r,
                  queryIndex: i,
                });
              }

              logger.debug("Search results extracted", {
                query,
                count: output.results.length,
              });
            } else {
              logger.warn("No search results extracted for query", { query });
            }
          } catch (error) {
            logger.error("Search query failed", {
              query,
              error: error instanceof Error ? error.message : String(error),
            });
            // Continue to next query
          }
        }
      } finally {
        resolveResults!(deduplicateResults(allResults));
      }
    },
    onError: (error) => {
      logger.error("Error in search agent stream", {
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
