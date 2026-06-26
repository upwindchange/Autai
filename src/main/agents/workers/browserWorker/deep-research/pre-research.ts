import {
  streamText,
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import { complexModel } from "@agents/providers";
import {
  hasSuccessfulToolResult,
  retryStreamTextForTool,
  TIMEOUTS,
} from "@agents/utils";
import {
  executeSearchQueries,
  type SearchResultItem,
} from "../browser-research/search-agent";
import type { ResearchPlan } from "../browser-research/planner";
import { settingsService } from "@/services";
import { i18n } from "@/i18n";
import log from "electron-log/main";

const logger = log.scope("deep-research-pre-research");

// ===== Schema =====

const broadQueriesSchema = z.object({
  topicOverview: z
    .string()
    .min(1)
    .describe("A 1-2 sentence summary of what the topic is about"),
  queries: z
    .array(
      z.object({
        query: z
          .string()
          .min(1)
          .describe(
            "A broad Google search query to get an overview of the topic",
          ),
        rationale: z
          .string()
          .min(1)
          .describe("Why this query helps understand the overall landscape"),
      }),
    )
    .min(2)
    .max(3)
    .describe("2-3 broad search queries for pre-research"),
});

// ===== Tool =====

type BroadQueriesOutput = z.infer<typeof broadQueriesSchema>;

const showBroadQueriesTool = tool({
  description: "Return broad exploratory search queries for pre-research",
  inputSchema: broadQueriesSchema,
  execute: async (input) => {
    return input as BroadQueriesOutput;
  },
});

// ===== System Prompts =====

const PRE_RESEARCH_QUERY_PROMPT = `You are a research strategist. Your job is to generate broad, exploratory search queries to understand the landscape of a topic.

## Your Task
Given a user's research question, generate 2-3 broad search queries that will help understand:
- What the topic encompasses
- What major areas or perspectives exist
- What information is readily available

## Query Strategy
- Queries should be BROAD and exploratory, not targeted
- Aim to discover the overall landscape, not answer the question directly
- Use general terms that will surface overviews, guides, and surveys
- Different angles/perspectives when possible

## Output
Call the showBroadQueries tool with your broad exploratory queries.`;

const INTERNAL_SUMMARY_PROMPT = `You are a research analyst. Given a user's research question and some quick search snippets, provide a concise internal summary.

## Guidelines
1. Summarize what the search results reveal about the topic
2. Note the major areas, perspectives, or sub-topics discovered
3. Identify any ambiguity or multiple possible interpretations of the user's question
4. Keep the summary concise but informative (2-4 paragraphs)
5. Focus on what you learned that wasn't obvious from the question alone

## Output
Provide a clear, factual summary of the pre-research findings.`;

// ===== Result Type =====

export interface PreResearchResult {
  summaryText: string;
  searchResults: SearchResultItem[];
  plan: ResearchPlan;
}

// ===== Main Exported Function =====

export async function runPreResearch(
  messages: ModelMessage[],
  sessionId: string,
  tabId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writer: { write: (chunk: any) => void },
  chatLanguageModel: LanguageModel,
  signal?: AbortSignal,
): Promise<PreResearchResult> {
  logger.debug("Starting pre-research scan");

  try {
    const userQuestion = extractUserQuestion(messages);

    // ============================================================
    // Step 1: Generate broad exploratory queries via tool call
    // ============================================================
    const maxRetries = settingsService.settings.maxRetries;

    const broadQueries = await retryStreamTextForTool(
      () =>
        streamText({
          model: complexModel(),
          prompt: userQuestion,
          system: PRE_RESEARCH_QUERY_PROMPT,
          tools: {
            showBroadQueries: showBroadQueriesTool,
          },
          toolChoice: {
            type: "tool",
            toolName: "showBroadQueries",
          },
          stopWhen: [
            hasSuccessfulToolResult("showBroadQueries"),
            stepCountIs(10),
          ],
          maxRetries,
          timeout: TIMEOUTS.planning,
          abortSignal: signal,
          experimental_telemetry: {
            isEnabled: settingsService.settings.langfuse.enabled,
            functionId: "deep-research-pre-research-queries",
          },
        }),
      "showBroadQueries",
      (output) => output as BroadQueriesOutput,
      { maxAttempts: maxRetries, logger },
    );

    if (!broadQueries) {
      throw new Error("Pre-research failed: could not generate broad queries");
    }

    logger.debug("Broad queries generated", {
      queryCount: broadQueries.queries.length,
      topicOverview: broadQueries.topicOverview,
    });

    // ============================================================
    // Step 2: Construct a synthetic plan and execute searches
    // executeSearchQueries shows a plan card with per-query progress
    // (pending → in_progress → completed) in the UI.
    // ============================================================
    const syntheticPlan: ResearchPlan = {
      id: `pre-research-plan-${sessionId}`,
      title: i18n.t("agents.preResearchTitle"),
      description: broadQueries.topicOverview,
      queries: broadQueries.queries.map((q, index) => ({
        id: `pre-research-query-${sessionId}-${index}`,
        query: q.query,
        focus: q.rationale,
      })),
    };

    const searchResults = await executeSearchQueries(
      syntheticPlan,
      sessionId,
      tabId,
      writer,
      `pre-research-search-${sessionId}`,
      signal,
    );

    logger.info("Pre-research searches complete", {
      resultCount: searchResults.length,
    });

    if (searchResults.length === 0) {
      return {
        summaryText: broadQueries.topicOverview,
        searchResults: [],
        plan: syntheticPlan,
      };
    }

    // ============================================================
    // Step 3: Generate an internal summary from snippets
    // ============================================================
    const snippetsContext = searchResults
      .map(
        (r, index) =>
          `### [${index + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`,
      )
      .join("\n\n---\n\n");

    const summaryResult = streamText({
      model: chatLanguageModel,
      messages: [
        {
          role: "user",
          content: `## User's Research Question\n${userQuestion}\n\n## Quick Search Snippets\n${snippetsContext}\n\nBased on these snippets, provide a concise summary of what you found about this topic. Focus on: major areas discovered, different perspectives, and anything surprising or unexpected.`,
        },
      ],
      system: INTERNAL_SUMMARY_PROMPT,
      maxRetries,
      timeout: TIMEOUTS.chat,
      abortSignal: signal,
      experimental_telemetry: {
        isEnabled: settingsService.settings.langfuse.enabled,
        functionId: "deep-research-pre-research-summary",
      },
    });

    // Capture text without streaming to the UI
    const summaryText = await summaryResult.text;

    logger.info("Pre-research completed", {
      resultCount: searchResults.length,
      summaryLength: summaryText.length,
    });

    return {
      summaryText,
      searchResults,
      plan: syntheticPlan,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Pre-research failed", { error: errorMsg });

    // Return empty result so the workflow can continue without pre-research
    return {
      summaryText: "",
      searchResults: [],
      plan: {
        id: `pre-research-${sessionId}`,
        title: "Pre-research (failed)",
        description: errorMsg,
        queries: [],
      },
    };
  }
}

// ===== Helpers =====

function extractUserQuestion(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter(
            (part): part is { type: "text"; text: string } =>
              "type" in part && part.type === "text",
          )
          .map((part) => part.text);
        if (textParts.length > 0) {
          return textParts.join("\n");
        }
      }
    }
  }
  return "Unknown topic";
}
