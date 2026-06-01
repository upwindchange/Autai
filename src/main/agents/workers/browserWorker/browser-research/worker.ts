import {
  createUIMessageStream,
  UIMessageChunk,
  ModelMessage,
  type UIMessage,
} from "ai";
import { SessionTabService, settingsService } from "@/services";
import { i18n } from "@/i18n";
import { sendAlert } from "@/utils/messageUtils";
import { flushTelemetry } from "@/agents/utils/telemetry";
import log from "electron-log/main";
import { observe } from "@langfuse/tracing";
import { researchPlanner, type ResearchPlan } from "./planner";
import { executeSearchQueries } from "./search-agent";
import { extractResultsFromUrls } from "./result-extractor";
import { summarizeFindings, summarizeFindingsFromSnippets } from "./summarizer";
import {
  mergeStreamAndWait,
  writeSimulatedToolCallToStream,
  retryStreamTextForTool,
  isAbortError,
  isTimeoutError,
} from "@agents/utils";

const logger = log.scope("Browser Research Worker");

export async function browserResearchWorker(
  messages: ModelMessage[],
  sessionId: string,
  originalMessages: UIMessage[],
  onFinish?: (messages: UIMessage[]) => void,
  options?: { skipExtraction?: boolean },
  signal?: AbortSignal,
): Promise<ReadableStream<UIMessageChunk>> {
  logger.info("Entering Browser Research worker", { sessionId });

  const wrapped = observe(
    async () => {
      return createUIMessageStream({
        originalMessages,
        onFinish:
          onFinish ?
            ({ messages: finalMessages }) => onFinish(finalMessages)
          : undefined,
        execute: async ({ writer }) => {
          try {
            // ============================================================
            // Setup: Get active tab
            // ============================================================
            const sessionTabService = SessionTabService.getInstance();
            let tabId = sessionTabService.getActiveTabForSession(sessionId);

            if (!tabId) {
              logger.debug("No active tab found, creating a new tab");
              tabId = await sessionTabService.createTab({ sessionId });
            }

            // Note: executeSearchQueries destroys all session tabs and creates
            // its own per-query tabs. tabId is only used as a seed.

            // ============================================================
            // Stage 1: Research Planning
            // ============================================================
            logger.debug("Stage 1: Generating research plan");
            const maxRetries = settingsService.settings.maxRetries;

            const plan = await retryStreamTextForTool(
              () => researchPlanner(messages, sessionId, signal),
              "showResearchPlan",
              (output) => output as ResearchPlan,
              { maxAttempts: maxRetries, logger },
            );

            if (!plan) {
              logger.error("Failed to generate research plan after retries");
              throw new Error(
                "Failed to generate research plan: showResearchPlan tool not called after retries",
              );
            }

            // Show the research plan in UI (matches the search plan schema)
            writeSimulatedToolCallToStream({
              writer,
              toolCallId: `research-search-${sessionId}`,
              toolName: "plan",
              input: {
                title: i18n.t("agents.searchingTitle", { title: plan.title }),
                description: plan.description,
              },
              output: {
                id: `research-search-${sessionId}`,
                title: i18n.t("agents.searchingTitle", { title: plan.title }),
                description: plan.description,
                todos: plan.queries.map((q) => ({
                  id: q.id,
                  label: i18n.t("agents.searchLabel", { query: q.query }),
                  status: "pending" as const,
                  description: q.focus,
                })),
              },
            });

            logger.info("Research plan generated", {
              queryCount: plan.queries.length,
              title: plan.title,
            });

            // ============================================================
            // Stage 2: Execute Search Queries
            // ============================================================
            logger.debug("Stage 2: Executing search queries");
            const searchResults = await executeSearchQueries(
              plan,
              sessionId,
              tabId,
              writer,
              undefined,
              signal,
            );

            logger.info("Search complete", {
              resultCount: searchResults.length,
            });

            if (searchResults.length === 0) {
              const textId = "text-no-results";
              writer.write({ type: "text-start", id: textId });
              writer.write({
                type: "text-delta",
                id: textId,
                delta: i18n.t("agents.noResultsFound"),
              });
              writer.write({ type: "text-end", id: textId });
              return;
            }

            // ============================================================
            // Stage 3: Extract Results from URLs (skipped in quick mode)
            // ============================================================
            let presentableSources: Array<{ url: string; title: string }>;

            if (options?.skipExtraction) {
              // Quick mode: skip extraction, summarize from snippets directly
              logger.debug("Stage 3: Skipped (quick search mode)");
              logger.debug("Stage 4: Summarizing findings from snippets");
              const summaryResult = await summarizeFindingsFromSnippets(
                messages,
                searchResults,
                sessionId,
                signal,
              );
              await mergeStreamAndWait(
                summaryResult.toUIMessageStream({ sendStart: false }),
                writer,
              );
              presentableSources = searchResults.map((r) => ({
                url: r.url,
                title: r.title,
              }));
            } else {
              // Full mode: extract then summarize
              logger.debug("Stage 3: Extracting results from URLs");
              const extractionResults = await extractResultsFromUrls(
                searchResults,
                plan.queries,
                sessionId,
                writer,
                undefined,
                signal,
              );

              logger.info("Extraction complete", {
                extractionCount: extractionResults.length,
                relevantCount: extractionResults.filter((r) => r.relevant).length,
              });

              // ============================================================
              // Stage 4: Summarize Findings
              // ============================================================
              logger.debug("Stage 4: Summarizing findings");
              const summaryResult = await summarizeFindings(
                messages,
                extractionResults,
                sessionId,
                signal,
              );
              await mergeStreamAndWait(
                summaryResult.toUIMessageStream({ sendStart: false }),
                writer,
              );
              presentableSources = extractionResults
                .filter((r) => r.relevant)
                .map((r) => ({ url: r.url, title: r.title }));
            }

            // ============================================================
            // Stage 5: Append References + Present Sources
            // ============================================================
            if (presentableSources.length > 0) {
              const referenceList = presentableSources
                .map((s, i) => `[${i + 1}] ${s.title} - ${s.url}`)
                .join("\n");
              const refId = "text-references";
              writer.write({ type: "text-start", id: refId });
              writer.write({
                type: "text-delta",
                id: refId,
                delta: `\n\n<details>\n<summary>References</summary>\n\n${referenceList}\n\n</details>`,
              });
              writer.write({ type: "text-end", id: refId });

              writeSimulatedToolCallToStream({
                writer,
                toolCallId: `research-sources-${sessionId}`,
                toolName: "presentSources",
                input: { sources: presentableSources },
                output: { sources: presentableSources },
              });
            }

            logger.info("Research workflow completed successfully");
          } finally {
            await flushTelemetry();
          }
        },
        onError: (error) => {
          if (isAbortError(error)) {
            logger.info("Research worker cancelled by user");
            return "";
          }
          const msg = error instanceof Error ? error.message : String(error);
          logger.error("Error in research worker", {
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
              i18n.t("agents.researchErrorTitle"),
              i18n.t("agents.researchErrorBody", { error: msg }),
            );
          }
          return msg;
        },
      });
    },
    { name: "browser-research-worker", endOnExit: false },
  );

  return wrapped() as Promise<ReadableStream<UIMessageChunk>>;
}
