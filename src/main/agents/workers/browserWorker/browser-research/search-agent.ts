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
import { interceptClickUrlTool } from "@agents/tools/InteractiveTools";
import { settingsService, SessionTabService } from "@/services";
import type { ResearchPlan } from "./planner";
import log from "electron-log/main";

const logger = log.scope("research-search-agent");
const generateId = createIdGenerator({ prefix: "call", size: 24 });

// ===== Schemas & Types =====

const rawSearchResultSchema = z.object({
  backendNodeId: z
    .number()
    .describe("The backendNodeId of the search result's anchor element"),
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

const rawSearchResultsSchema = z.object({
  results: z
    .array(rawSearchResultSchema)
    .min(1)
    .max(5)
    .describe("The most relevant search results found (up to 5)"),
});

type RawSearchResult = z.infer<typeof rawSearchResultSchema>;

export type SearchResultItem = {
  url: string;
  title: string;
  snippet: string;
  relevanceScore: number;
  queryIndex: number;
};

// ===== Tool =====

const showSearchResultsTool = tool({
  description: "Return the analyzed search results from the Google page",
  inputSchema: rawSearchResultsSchema,
  execute: async (input) => {
    return input;
  },
});

// ===== System Prompt =====

const searchAnalysisPrompt = `You are a web search analyst. You are viewing the flattened DOM of a Google search results page.

## Your Task
Analyze the search results displayed in the DOM and identify the most relevant links.

## Instructions
1. Look at the search results in the DOM
2. Each DOM element has a backendNodeId attribute — use it to identify links
3. Identify the most relevant results based on:
   - Title relevance to the search query
   - Snippet/content relevance to the focus area
   - Source authority (prefer official docs, well-known sites)
4. For each result, provide:
   - backendNodeId of the anchor element
   - Title text
   - Brief snippet
   - Relevance score (1-10)
5. Skip ads, sponsored results, and navigation links
6. Focus on organic search results only
7. Only include results from the first page of Google results
8. Do NOT try to extract or construct URLs — just provide the backendNodeId

## Important
- Each element in the DOM has a backendNodeId — use that to reference the link
- Google search result links are anchor (<a>) elements
- Skip Google's own navigation (Images, Videos, News tabs, etc.)
- Exclude PDF links unless specifically relevant
- Call showSearchResults with your analysis`;

// ===== Helpers: Direct tool execution with context =====

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

async function interceptLinkUrl(
  backendNodeId: number,
  sessionId: string,
  activeTabId: string,
): Promise<string | null> {
  const result = await interceptClickUrlTool.execute!(
    { backendNodeId },
    {
      toolCallId: generateId(),
      messages: [],
      experimental_context: { sessionId, activeTabId },
    },
  );
  return (result as { interceptedUrl?: string }).interceptedUrl ?? null;
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

// ===== URL Resolution =====

async function resolveSearchResultUrls(
  rawResults: RawSearchResult[],
  queryIndex: number,
  sessionId: string,
  activeTabId: string,
): Promise<SearchResultItem[]> {
  const resolved: SearchResultItem[] = [];

  for (const r of rawResults) {
    const url = await interceptLinkUrl(r.backendNodeId, sessionId, activeTabId);
    if (url) {
      resolved.push({
        url,
        title: r.title,
        snippet: r.snippet,
        relevanceScore: r.relevanceScore,
        queryIndex,
      });
    } else {
      logger.warn("Failed to intercept URL for backendNodeId", {
        backendNodeId: r.backendNodeId,
        title: r.title,
      });
    }
  }

  return resolved;
}

// ===== Single Query Execution =====

async function executeSingleSearchQuery(
  query: string,
  focus: string,
  queryIndex: number,
  sessionId: string,
  tabId: string,
  sessionTabService: SessionTabService,
): Promise<SearchResultItem[]> {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  logger.debug("Searching", { query, searchUrl });

  try {
    await navigateTo(searchUrl, sessionId, tabId);

    // Set this tab as the active tab for the session and show it
    const state = sessionTabService.getSessionTabState(sessionId);
    if (state) state.activeTabId = tabId;
    await sessionTabService.setBackendVisibility(tabId, true);

    const domRepresentation = await getFlattenDOM(sessionId, tabId);

    const truncatedDom =
      domRepresentation.length > 50000 ?
        domRepresentation.slice(0, 50000) + "\n\n[... content truncated ...]"
      : domRepresentation;

    logger.debug("DOM received for search analysis", {
      query,
      domLength: domRepresentation.length,
      truncatedLength: truncatedDom.length,
    });

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
      stopWhen: [hasSuccessfulToolResult("showSearchResults"), stepCountIs(10)],
      experimental_telemetry: {
        isEnabled: settingsService.settings.langfuse.enabled,
        functionId: "research-search-analysis",
        metadata: {
          queryIndex,
          query,
        },
      },
    });

    const steps = await analysisResult.steps;
    const toolResult = steps
      .flatMap((s) => s.toolResults ?? [])
      .find(
        (tr) =>
          tr.toolName === "showSearchResults" && tr.type === "tool-result",
      );

    if (toolResult) {
      const output = toolResult.output as {
        results: RawSearchResult[];
      };

      const resolved = await resolveSearchResultUrls(
        output.results,
        queryIndex,
        sessionId,
        tabId,
      );

      logger.debug("Search results resolved", {
        query,
        rawCount: output.results.length,
        resolvedCount: resolved.length,
      });

      return resolved;
    }

    logger.warn("LLM failed to extract search results", { query });
    return [];
  } catch (error) {
    logger.error("Search query failed", {
      query,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ===== Main Exported Function =====

export async function executeSearchQueries(
  plan: ResearchPlan,
  sessionId: string,
  _activeTabId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writer: { write: (chunk: any) => void },
): Promise<SearchResultItem[]> {
  const sessionTabService = SessionTabService.getInstance();
  const searchPlanId = `research-search-${sessionId}`;

  // Close ALL existing tabs in the session
  await sessionTabService.destroyAllTabs(sessionId);

  // Create one tab per query
  for (let i = 0; i < plan.queries.length; i++) {
    await sessionTabService.createTab({ sessionId });
  }
  const tabIds = sessionTabService.getTabsForSession(sessionId);

  try {
    // Emit progress: all queries "in_progress"
    writeSimulatedToolCallToStream({
      writer,
      toolCallId: searchPlanId,
      toolName: "plan",
      input: {
        title: `Searching: ${plan.title}`,
        description: plan.description,
        todos: plan.queries.map((q) => ({
          id: q.id,
          label: `Search: "${q.query}"`,
          status: "in_progress" as const,
          description: q.focus,
        })),
      },
      output: {
        id: searchPlanId,
        title: `Searching: ${plan.title}`,
        description: plan.description,
        todos: plan.queries.map((q) => ({
          id: q.id,
          label: `Search: "${q.query}"`,
          status: "in_progress" as const,
          description: q.focus,
        })),
      },
    });

    // Run all queries in parallel
    const settledResults = await Promise.allSettled(
      tabIds.map((tabId, i) => {
        const { query, focus } = plan.queries[i];
        return executeSingleSearchQuery(
          query,
          focus,
          i,
          sessionId,
          tabId,
          sessionTabService,
        );
      }),
    );

    // Collect results
    const allResults: SearchResultItem[] = [];
    for (let i = 0; i < settledResults.length; i++) {
      const result = settledResults[i];
      if (result.status === "fulfilled") {
        allResults.push(...result.value);
      } else {
        logger.error("Parallel search query failed", {
          queryIndex: i,
          query: plan.queries[i].query,
          error:
            result.reason instanceof Error ?
              result.reason.message
            : String(result.reason),
        });
      }
    }

    // Emit progress: all queries "completed"
    writeSimulatedToolCallToStream({
      writer,
      toolCallId: searchPlanId,
      toolName: "plan",
      input: {
        title: `Searching: ${plan.title}`,
        description: plan.description,
        todos: plan.queries.map((q) => ({
          id: q.id,
          label: `Search: "${q.query}"`,
          status: "completed" as const,
          description: q.focus,
        })),
      },
      output: {
        id: searchPlanId,
        title: `Searching: ${plan.title}`,
        description: plan.description,
        todos: plan.queries.map((q) => ({
          id: q.id,
          label: `Search: "${q.query}"`,
          status: "completed" as const,
          description: q.focus,
        })),
      },
    });

    return deduplicateResults(allResults);
  } finally {
    // Destroy ALL tabs
    await sessionTabService.destroyAllTabs(sessionId);
  }
}
