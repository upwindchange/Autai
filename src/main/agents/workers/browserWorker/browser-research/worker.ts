import {
  streamText,
  createUIMessageStream,
  UIMessageChunk,
  ModelMessage,
  type UIMessage,
} from "ai";
import { chatModel } from "@agents/providers";
import { settingsService, SessionTabService } from "@/services";
import { trace, context } from "@opentelemetry/api";
import log from "electron-log/main";
import { researchPlanner, type ResearchPlan } from "./planner";
import { executeSearchQueries } from "./search-agent";
import { extractResultsFromUrls } from "./result-extractor";
import { summarizeFindings } from "./summarizer";
import { mergeStreamAndWait } from "@agents/utils";

const logger = log.scope("Browser Research Worker");

export async function browserResearchWorker(
  messages: ModelMessage[],
  sessionId: string,
  originalMessages: UIMessage[],
  onFinish?: (messages: UIMessage[]) => void,
): Promise<ReadableStream<UIMessageChunk>> {
  logger.info("Entering Browser Research worker", { sessionId });

  return createUIMessageStream({
    originalMessages,
    onFinish:
      onFinish ?
        ({ messages: finalMessages }) => onFinish(finalMessages)
      : undefined,
    execute: async ({ writer }) => {
      // Create a root span for observability
      const tracer = trace.getTracer("research-worker", "1.0.0");
      const rootSpan = tracer.startSpan("research-worker");
      rootSpan.setAttribute("session.id", sessionId);

      return context.with(
        trace.setSpan(context.active(), rootSpan),
        async () => {
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

            // ============================================================
            // Stage 1: Research Planning
            // ============================================================
            logger.debug("Stage 1: Generating research plan");
            const planResult = await researchPlanner(messages, sessionId);

            await mergeStreamAndWait(
              planResult.toUIMessageStream({ sendStart: false }),
              writer,
            );

            // Extract plan from tool result
            const planSteps = await planResult.steps;
            const planToolResult = planSteps
              .flatMap((s) => s.toolResults ?? [])
              .find(
                (tr) =>
                  tr.toolName === "showResearchPlan" &&
                  tr.type === "tool-result",
              );
            const plan = planToolResult?.output as ResearchPlan | undefined;

            if (!plan) {
              logger.error("Failed to generate research plan");
              throw new Error(
                "Failed to generate research plan: showResearchPlan tool not called",
              );
            }

            logger.info("Research plan generated", {
              queryCount: plan.queries.length,
              title: plan.title,
            });

            // ============================================================
            // Stage 2: Execute Search Queries
            // ============================================================
            logger.debug("Stage 2: Executing search queries");
            const { stream: searchStream, results: searchResultsPromise } =
              await executeSearchQueries(plan, sessionId, tabId, messages);

            await mergeStreamAndWait(searchStream, writer);

            const searchResults = await searchResultsPromise;

            logger.info("Search complete", {
              resultCount: searchResults.length,
            });

            if (searchResults.length === 0) {
              // No results found - stream a message and return
              const noResultStream = streamText({
                model: chatModel(),
                messages,
                system:
                  "You are a research assistant. Inform the user that no relevant search results were found for their query and suggest they try rephrasing their question.",
                experimental_telemetry: {
                  isEnabled: settingsService.settings.langfuse.enabled,
                  functionId: "research-no-results",
                },
              });
              await mergeStreamAndWait(
                noResultStream.toUIMessageStream({ sendStart: false }),
                writer,
              );
              return;
            }

            // ============================================================
            // Stage 3: Extract Results from URLs
            // ============================================================
            logger.debug("Stage 3: Extracting results from URLs");
            const {
              stream: extractionStream,
              results: extractionResultsPromise,
            } = await extractResultsFromUrls(
              searchResults,
              plan.queries,
              sessionId,
              tabId,
              messages,
            );

            await mergeStreamAndWait(extractionStream, writer);

            const extractionResults = await extractionResultsPromise;

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
            );

            await mergeStreamAndWait(
              summaryResult.toUIMessageStream({ sendStart: false }),
              writer,
            );

            logger.info("Research workflow completed successfully");
          } finally {
            rootSpan.end();
          }
        },
      );
    },
    onError: (error) => {
      logger.error("Error in research worker", {
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return error instanceof Error ? error.message : String(error);
    },
  });
}
