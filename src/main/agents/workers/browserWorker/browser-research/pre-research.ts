import { generateText, Output, type ModelMessage } from "ai";
import { z } from "zod";
import { complexModel } from "@agents/providers";
import {
  writeSimulatedToolCallToStream,
  TIMEOUTS,
} from "@agents/utils";
import { executeSearchQueries, type SearchResultItem } from "./search-agent";
import type { ResearchPlan } from "./planner";
import { settingsService } from "@/services";
import { i18n } from "@/i18n";
import log from "electron-log/main";

const logger = log.scope("research-pre-research");

// ===== Schema for broad exploratory queries =====

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
          .describe(
            "Why this query helps understand the overall landscape",
          ),
      }),
    )
    .min(2)
    .max(3)
    .describe("2-3 broad search queries for pre-research"),
});

// ===== System Prompt =====

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
Return a JSON object with a brief topic overview and 2-3 broad search queries.`;

// ===== Internal Summary Prompt =====

const INTERNAL_SUMMARY_PROMPT = `You are a research analyst. Given a user's research question and some quick search snippets, provide a concise internal summary.

## Guidelines
1. Summarize what the search results reveal about the topic
2. Note the major areas, perspectives, or sub-topics discovered
3. Identify any ambiguity or multiple possible interpretations of the user's question
4. Keep the summary concise but informative (2-4 paragraphs)
5. Focus on what you learned that wasn't obvious from the question alone

## Output
Provide a clear, factual summary of the pre-research findings.`;

// ===== Main Exported Function =====

export async function preResearch(
  messages: ModelMessage[],
  sessionId: string,
  tabId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writer: { write: (chunk: any) => void },
): Promise<{ searchResults: SearchResultItem[]; summary: string }> {
  logger.debug("Starting pre-research", { sessionId });

  // Extract the user's question from messages
  const userQuestion = extractUserQuestion(messages);

  // Show a brief UI indicator
  writeSimulatedToolCallToStream({
    writer,
    toolCallId: `pre-research-${sessionId}`,
    toolName: "preResearch",
    input: {
      title: i18n.t("agents.preResearchTitle", { title: userQuestion }),
    },
    output: {
      id: `pre-research-${sessionId}`,
      title: i18n.t("agents.preResearchTitle", { title: userQuestion }),
      description: i18n.t("agents.preResearchDescription"),
    },
  });

  // ============================================================
  // Step 1: Generate broad exploratory queries
  // ============================================================
  const queryResult = await generateText({
    model: complexModel(),
    prompt: userQuestion,
    system: PRE_RESEARCH_QUERY_PROMPT,
    output: Output.object({ schema: broadQueriesSchema }),
    timeout: TIMEOUTS.planning,
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "research-pre-research-queries",
    },
  });

  const broadQueries = queryResult.output;
  logger.debug("Broad queries generated", {
    queryCount: broadQueries.queries.length,
    topicOverview: broadQueries.topicOverview,
  });

  // ============================================================
  // Step 2: Construct a synthetic ResearchPlan and execute searches
  // ============================================================
  const syntheticPlan: ResearchPlan = {
    id: `pre-research-plan-${sessionId}`,
    title: `Pre-research: ${userQuestion}`,
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
  );

  logger.debug("Pre-research search complete", {
    resultCount: searchResults.length,
  });

  if (searchResults.length === 0) {
    logger.warn("No pre-research results found, returning topic overview only");
    return {
      searchResults: [],
      summary: broadQueries.topicOverview,
    };
  }

  // ============================================================
  // Step 3: Generate an internal summary from snippets
  // ============================================================
  const snippetsContext = searchResults
    .map((r, index) => {
      return `### [${index + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`;
    })
    .join("\n\n---\n\n");

  const summaryResult = await generateText({
    model: complexModel(),
    messages: [
      {
        role: "user",
        content: `## User's Research Question\n${userQuestion}\n\n## Quick Search Snippets\n${snippetsContext}\n\nBased on these snippets, provide a concise summary of what you found about this topic. Focus on: major areas discovered, different perspectives, and anything surprising or unexpected.`,
      },
    ],
    system: INTERNAL_SUMMARY_PROMPT,
    timeout: TIMEOUTS.chat,
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "research-pre-research-summary",
    },
  });

  const summary = await summaryResult.text;

  logger.debug("Pre-research summary generated", {
    summaryLength: summary.length,
  });

  return { searchResults, summary };
}

// ===== Helpers =====

function extractUserQuestion(messages: ModelMessage[]): string {
  // Find the last user message as the primary question
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        return msg.content;
      }
      // Handle array content (text parts)
      if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text);
        if (textParts.length > 0) {
          return textParts.join("\n");
        }
      }
    }
  }
  return "Unknown topic";
}
