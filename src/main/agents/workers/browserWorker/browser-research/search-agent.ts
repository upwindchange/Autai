import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { createIdGenerator } from "@ai-sdk/provider-utils";
import { complexModel } from "@agents/providers";
import {
  hasSuccessfulToolResult,
  writeSimulatedToolCallToStream,
  concurrentBatch,
  TIMEOUTS,
  isTimeoutError,
  type BatchStatusUpdate,
  type TaskStatus,
} from "@agents/utils";
import { navigateTool } from "@agents/tools/TabControlTools";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { interceptClickUrlTool } from "@agents/tools/InteractiveTools";
import { getAttributeTool } from "@agents/tools/InteractiveTools";
import { getAllAttributesTool } from "@agents/tools/InteractiveTools";
import { settingsService, SessionTabService } from "@/services";
import { i18n } from "@/i18n";
import { sendAlert } from "@/utils/messageUtils";
import type { ResearchPlan } from "./planner";
import type { SearchEngine, CustomSearchEngine } from "@shared";
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

// ===== Search Engine Configuration =====

interface SearchEngineConfig {
  buildUrl: (query: string) => string;
  displayName: string;
  domHint: string;
  navElements: string;
}

const SEARCH_ENGINE_CONFIGS: Record<
  Exclude<SearchEngine, "custom">,
  SearchEngineConfig
> = {
  google: {
    buildUrl: (q) =>
      `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    displayName: "Google",
    domHint: "Google search result links are anchor (<a>) elements",
    navElements:
      "Google's own navigation (Images, Videos, News tabs, etc.)",
  },
  bing: {
    buildUrl: (q) =>
      `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    displayName: "Bing",
    domHint: "Bing search result links are anchor (<a>) elements, often inside <li> with class 'b_algo'",
    navElements: "Bing's own navigation and sidebar elements",
  },
  bingChina: {
    buildUrl: (q) =>
      `https://www.bing.com/search?q=${encodeURIComponent(q)}&mkt=zh-CN`,
    displayName: "必应 (Bing China)",
    domHint: "Bing search result links are anchor (<a>) elements, often inside <li> with class 'b_algo'",
    navElements: "Bing's own navigation and sidebar elements",
  },
  duckduckgo: {
    buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    displayName: "DuckDuckGo",
    domHint: "DuckDuckGo search results are in articles with class 'result'",
    navElements: "DuckDuckGo's own navigation and ad elements",
  },
  baidu: {
    buildUrl: (q) =>
      `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
    displayName: "百度",
    domHint: "Baidu search results are in div elements with class 'result' or 'c-container'",
    navElements:
      "Baidu's own navigation, ads (often labeled '广告'), and promoted content",
  },
  sogou: {
    buildUrl: (q) =>
      `https://www.sogou.com/web?query=${encodeURIComponent(q)}`,
    displayName: "搜狗",
    domHint: "Sogou search results are in div elements with class 'vrwrap' or 'rb'",
    navElements: "Sogou's own navigation, ads, and promoted content",
  },
  brave: {
    buildUrl: (q) =>
      `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
    displayName: "Brave Search",
    domHint: "Brave Search result links are anchor elements inside divs with class 'snippet'",
    navElements: "Brave's own navigation and ad elements",
  },
};

function getEngineConfig(
  engine: SearchEngine,
  custom?: CustomSearchEngine,
): SearchEngineConfig {
  if (engine === "custom") {
    const name = custom?.name || "Custom";
    const template = custom?.urlTemplate || "";
    return {
      buildUrl: (q) => template.replace("%s", encodeURIComponent(q)),
      displayName: name,
      domHint: "Search result links are anchor (<a>) elements",
      navElements: "navigation, ads, and promoted content",
    };
  }
  return SEARCH_ENGINE_CONFIGS[engine];
}

// ===== Tool =====

const showSearchResultsTool = tool({
  description: "Return the analyzed search results from the search engine page",
  inputSchema: rawSearchResultsSchema,
  execute: async (input) => {
    return input;
  },
});

// ===== System Prompt =====

function buildSearchAnalysisPrompt(engineConfig: SearchEngineConfig): string {
  return `You are a web search analyst. You are viewing the flattened DOM of a ${engineConfig.displayName} search results page.

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
7. Only include results from the first page of results
8. Do NOT try to extract or construct URLs — just provide the backendNodeId

## Important
- Each element in the DOM has a backendNodeId — use that to reference the link
- ${engineConfig.domHint}
- Skip ${engineConfig.navElements}
- Exclude PDF links unless specifically relevant
- Call showSearchResults with your analysis`;
}

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

function isValidUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

async function interceptLinkUrl(
  backendNodeId: number,
  sessionId: string,
  activeTabId: string,
): Promise<string | null> {
  const toolContext = {
    toolCallId: generateId(),
    messages: [],
    experimental_context: { sessionId, activeTabId },
  };

  // Tier 1: Try getAttribute("href") — single CDP call, ~10ms
  try {
    const attrResult = (await getAttributeTool.execute!(
      { backendNodeId, attributeName: "href" },
      toolContext,
    )) as { value?: string | null; exists?: boolean };
    if (attrResult.exists && attrResult.value && isValidUrl(attrResult.value)) {
      return attrResult.value;
    }
  } catch {
    // fall through to tier 2
  }

  // Tier 2: Try getAllAttributes — scan all attribute values for any URL
  try {
    const allAttrsResult = (await getAllAttributesTool.execute!(
      { backendNodeId },
      toolContext,
    )) as { attributes?: Record<string, string> };
    if (allAttrsResult.attributes) {
      for (const value of Object.values(allAttrsResult.attributes)) {
        if (isValidUrl(value)) {
          return value;
        }
      }
    }
  } catch {
    // fall through to tier 3
  }

  // Tier 3: Fallback to click + intercept — slow but handles JS navigation
  const result = (await interceptClickUrlTool.execute!(
    { backendNodeId },
    toolContext,
  )) as { interceptedUrl?: string };
  return result.interceptedUrl ?? null;
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
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const engine = settingsService.settings.searchEngine ?? "google";
  const engineConfig = getEngineConfig(
    engine,
    settingsService.settings.customSearchEngine,
  );
  const searchUrl = engineConfig.buildUrl(query);

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
          content: `Search query: "${query}"\nFocus: "${focus}"\n\n${engineConfig.displayName} search results DOM:\n${truncatedDom}`,
        },
      ],
      system: buildSearchAnalysisPrompt(engineConfig),
      tools: {
        showSearchResults: showSearchResultsTool,
      },
      toolChoice: {
        type: "tool",
        toolName: "showSearchResults",
      },
      stopWhen: [hasSuccessfulToolResult("showSearchResults"), stepCountIs(10)],
      maxRetries: settingsService.settings.maxRetries,
      timeout: TIMEOUTS.actionExecution,
      abortSignal: signal,
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Search query failed", {
      query,
      error: errorMessage,
    });
    if (isTimeoutError(error)) {
      sendAlert(
        i18n.t("agents.timeoutErrorTitle"),
        i18n.t("agents.timeoutErrorBody"),
      );
    } else {
      sendAlert(
        i18n.t("agents.searchErrorTitle"),
        i18n.t("agents.searchErrorBody", { query, error: errorMessage }),
      );
    }
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
  planId?: string,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const sessionTabService = SessionTabService.getInstance();
  const searchPlanId = planId ?? `research-search-${sessionId}`;

  // Close ALL existing tabs in the session
  await sessionTabService.destroyAllTabs(sessionId);

  // Create one tab per query
  for (let i = 0; i < plan.queries.length; i++) {
    await sessionTabService.createTab({ sessionId });
  }
  const tabIds = sessionTabService.getTabsForSession(sessionId);

  try {
    const concurrency = settingsService.settings.maxParallelAgents ?? 2;
    const taskStatuses: TaskStatus[] = plan.queries.map(() => "pending");

    const buildTodos = () =>
      plan.queries.map((q, idx) => ({
        id: q.id,
        label: i18n.t("agents.searchLabel", { query: q.query }),
        status: taskStatuses[idx],
        description: q.focus,
      }));

    const emitStatus = () => {
      writeSimulatedToolCallToStream({
        writer,
        toolCallId: searchPlanId,
        toolName: "plan",
        input: {
          title: i18n.t("agents.searchingTitle", { title: plan.title }),
          description: plan.description,
          todos: buildTodos(),
        },
        output: {
          id: searchPlanId,
          title: i18n.t("agents.searchingTitle", { title: plan.title }),
          description: plan.description,
          todos: buildTodos(),
        },
      });
    };

    // Emit initial "pending" state for all
    emitStatus();

    // Run queries with bounded concurrency and per-task status
    const settledResults = await concurrentBatch(
      tabIds.map((tabId, i) => ({
        index: i,
        execute: () =>
          executeSingleSearchQuery(
            plan.queries[i].query,
            plan.queries[i].focus,
            i,
            sessionId,
            tabId,
            sessionTabService,
            signal,
          ),
      })),
      concurrency,
      (update: BatchStatusUpdate) => {
        taskStatuses[update.index] = update.status;
        emitStatus();
      },
    );

    // Collect results
    const allResults: SearchResultItem[] = [];
    for (let i = 0; i < settledResults.length; i++) {
      const result = settledResults[i];
      if (result.status === "fulfilled") {
        allResults.push(...result.value);
      } else {
        const errorMessage =
          result.reason instanceof Error ?
            result.reason.message
          : String(result.reason);
        logger.error("Parallel search query failed", {
          queryIndex: i,
          query: plan.queries[i].query,
          error: errorMessage,
        });
        sendAlert(
          i18n.t("agents.searchErrorTitle"),
          i18n.t("agents.searchErrorBody", {
            query: plan.queries[i].query,
            error: errorMessage,
          }),
        );
      }
    }

    return deduplicateResults(allResults);
  } finally {
    // Destroy ALL tabs
    await sessionTabService.destroyAllTabs(sessionId);
  }
}
