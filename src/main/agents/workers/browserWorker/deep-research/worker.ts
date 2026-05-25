import {
  streamText,
  createUIMessageStream,
  type UIMessageChunk,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { chatModel } from "@agents/providers";
import { settingsService, SessionTabService } from "@/services";
import { i18n } from "@/i18n";
import { sendAlert } from "@/utils/messageUtils";
import { flushTelemetry } from "@/agents/utils/telemetry";
import log from "electron-log/main";
import { observe } from "@langfuse/tracing";
import { deepResearchPlanner, extractDeepPlanFromSteps } from "./planner";
import { researchPlanner } from "../browser-research/planner";
import type { ResearchPlan } from "../browser-research/planner";
import { executeSearchQueries } from "../browser-research/search-agent";
import { extractResultsFromUrls } from "../browser-research/result-extractor";
import { summarizeFindings } from "../browser-research/summarizer";
import { sourceTools } from "@agents/tools/SourceTools";
import {
  mergeStreamAndWait,
  writeSimulatedToolCallToStream,
  TIMEOUTS,
  isTimeoutError,
} from "@agents/utils";
import type {
  SubtopicResult,
  GlobalCitationEntry,
  RemappedSubtopic,
} from "./types";

const logger = log.scope("Deep Research Worker");

// ===== Citation Remapping =====

function buildGlobalCitationsAndRemap(subtopicResults: SubtopicResult[]): {
  remappedSummaries: RemappedSubtopic[];
  globalCitations: GlobalCitationEntry[];
} {
  const globalCitations: GlobalCitationEntry[] = [];
  const remappedSummaries: RemappedSubtopic[] = [];
  const urlToGlobalIndex = new Map<string, number>();
  let nextGlobalIndex = 1;

  for (let sIdx = 0; sIdx < subtopicResults.length; sIdx++) {
    const { subtopic, relevantResults, summaryText } = subtopicResults[sIdx];
    const localToGlobal = new Map<number, number>();

    for (let localIdx = 0; localIdx < relevantResults.length; localIdx++) {
      const result = relevantResults[localIdx];
      const localNumber = localIdx + 1;

      if (urlToGlobalIndex.has(result.url)) {
        localToGlobal.set(localNumber, urlToGlobalIndex.get(result.url)!);
      } else {
        const globalIndex = nextGlobalIndex++;
        urlToGlobalIndex.set(result.url, globalIndex);
        localToGlobal.set(localNumber, globalIndex);
        globalCitations.push({
          globalIndex,
          url: result.url,
          title: result.title,
          summary: result.summary,
          quotes: result.quotes,
        });
      }
    }

    // Remap [N] citations in the summary text
    const remappedText = summaryText.replace(/\[(\d+)\]/g, (match, numStr) => {
      const localNum = parseInt(numStr, 10);
      const globalNum = localToGlobal.get(localNum);
      if (globalNum !== undefined) {
        return `[${globalNum}]`;
      }
      return match;
    });

    remappedSummaries.push({ subtopic, text: remappedText });
  }

  return { remappedSummaries, globalCitations };
}

// ===== Composition Agent =====

const compositionSystemPrompt = `You are a research synthesis agent. You are given pre-researched subtopic summaries from a deep research investigation. Your task is to compose them into a single, coherent, comprehensive answer.

## Critical Rules
1. PRESERVE ALL factual content and specific claims from the subtopic summaries. Do not omit information — only reorganize for coherence.
2. PRESERVE ALL citation markers [N] exactly as they appear. Do NOT renumber, remove, or move any citations. Every [N] in the input must appear in your output.
3. You may reorganize the order of information for better flow and coherence.
4. Resolve overlaps between subtopics by merging redundant information (keeping the most detailed version).
5. Add transitional sentences between sections for smooth reading.
6. Organize information by theme, not by subtopic order.
7. If information is incomplete across subtopics, acknowledge what could not be found.
8. After writing your answer, call the presentSources tool with every unique source URL you referenced so the user can visit them.

## Structure
- Start with a table of contents
- Use journal article format
- use the abstract section to briefly answering the user's question
- Organize information logically by theme
- Use headers or sections
- End with a brief conclusion
- Do NOT list sources in the response text — instead, call the sourceTools tool to present them
- When calling sourceTools, list sources in the same order as their citation numbers [1], [2], ...

## Math
For inline math expressions, use double dollar signs like $$E = mc^2$$. Never use single dollar signs for math.`;

// ===== Plan Extraction Helper =====

async function extractPlanFromPlanner(
  planResult: Awaited<ReturnType<typeof researchPlanner>>,
): Promise<ResearchPlan> {
  const planSteps = await planResult.steps;
  const planToolResult = planSteps
    .flatMap((s) => s.toolResults ?? [])
    .find(
      (tr) => tr.toolName === "showResearchPlan" && tr.type === "tool-result",
    );
  const plan = planToolResult?.output as ResearchPlan | undefined;
  if (!plan) {
    throw new Error(
      "Failed to generate research plan: showResearchPlan tool not called",
    );
  }
  return plan;
}

// ===== Main Exported Function =====

export async function browserDeepResearchWorker(
  messages: ModelMessage[],
  sessionId: string,
  originalMessages: UIMessage[],
  onFinish?: (messages: UIMessage[]) => void,
): Promise<ReadableStream<UIMessageChunk>> {
  logger.info("Entering Deep Research worker", { sessionId });

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
            // Setup: Get active tab seed
            // ============================================================
            const sessionTabService = SessionTabService.getInstance();
            let tabId = sessionTabService.getActiveTabForSession(sessionId);

            if (!tabId) {
              logger.debug("No active tab found, creating a new tab");
              tabId = await sessionTabService.createTab({ sessionId });
            }

            // ============================================================
            // Stage 1: Deep Research Planning (decompose into subtopics)
            // ============================================================
            logger.debug("Stage 1: Generating deep research plan");
            const deepPlanResult = await deepResearchPlanner(
              messages,
              sessionId,
            );
            const deepPlanSteps = await deepPlanResult.steps;
            const deepPlan = extractDeepPlanFromSteps(deepPlanSteps);

            if (!deepPlan) {
              logger.error("Failed to generate deep research plan");
              throw new Error(
                "Failed to generate deep research plan: showDeepResearchPlan tool not called",
              );
            }

            // Show the deep research plan in UI
            const deepPlanId = `deep-research-plan-${sessionId}`;
            const emitDeepPlanStatus = (
              statuses: Array<"pending" | "in_progress" | "completed">,
            ) => {
              writeSimulatedToolCallToStream({
                writer,
                toolCallId: deepPlanId,
                toolName: "plan",
                input: {
                  title: i18n.t("agents.deepResearchTitle", {
                    title: deepPlan.title,
                  }),
                  description: deepPlan.researchQuestion,
                },
                output: {
                  id: deepPlanId,
                  title: i18n.t("agents.deepResearchTitle", {
                    title: deepPlan.title,
                  }),
                  description: deepPlan.researchQuestion,
                  todos: deepPlan.subtopics.map((st, idx) => ({
                    id: st.id,
                    label: st.title,
                    status: statuses[idx],
                    description: st.question,
                  })),
                },
              });
            };

            logger.info("Deep research plan generated", {
              subtopicCount: deepPlan.subtopics.length,
              title: deepPlan.title,
            });

            // ============================================================
            // Stage 2: Per-subtopic research loop (sequential)
            // ============================================================
            const subtopicResults: SubtopicResult[] = [];
            const subtopicStatuses: Array<
              "pending" | "in_progress" | "completed"
            > = deepPlan.subtopics.map(() => "pending");

            // Emit initial pending state
            emitDeepPlanStatus(subtopicStatuses);

            for (let subIdx = 0; subIdx < deepPlan.subtopics.length; subIdx++) {
              const subtopic = deepPlan.subtopics[subIdx];
              subtopicStatuses[subIdx] = "in_progress";
              emitDeepPlanStatus(subtopicStatuses);

              logger.debug("Processing subtopic", {
                subtopicIndex: subIdx,
                title: subtopic.title,
              });

              try {
                // 2a. Plan search queries for this subtopic
                const subtopicMessages: ModelMessage[] = [
                  ...messages,
                  {
                    role: "user" as const,
                    content: `For the following subtopic of a larger research question, please search the web and provide findings:\n\nSubtopic: ${subtopic.title}\nQuestion: ${subtopic.question}\nRationale: ${subtopic.rationale}`,
                  } as ModelMessage,
                ];

                const planResult = await researchPlanner(
                  subtopicMessages,
                  sessionId,
                );
                const plan = await extractPlanFromPlanner(planResult);

                logger.debug("Subtopic plan generated", {
                  subtopicIndex: subIdx,
                  queryCount: plan.queries.length,
                });

                // 2b. Execute searches
                const searchResults = await executeSearchQueries(
                  plan,
                  sessionId,
                  tabId,
                  writer,
                  `deep-search-${sessionId}-${subIdx}`,
                );

                if (searchResults.length === 0) {
                  logger.warn("No search results for subtopic", {
                    subtopicIndex: subIdx,
                  });
                  subtopicResults.push({
                    subtopic,
                    extractionResults: [],
                    summaryText: `No relevant search results were found for the subtopic "${subtopic.title}".`,
                    relevantResults: [],
                  });
                  continue;
                }

                // 2c. Extract results from URLs
                const extractionResults = await extractResultsFromUrls(
                  searchResults,
                  plan.queries,
                  sessionId,
                  writer,
                  `deep-extract-${sessionId}-${subIdx}`,
                );

                const relevantExtractions = extractionResults.filter(
                  (r) => r.relevant,
                );

                if (relevantExtractions.length === 0) {
                  logger.warn("No relevant extractions for subtopic", {
                    subtopicIndex: subIdx,
                  });
                  subtopicResults.push({
                    subtopic,
                    extractionResults,
                    summaryText: `No relevant content could be extracted for the subtopic "${subtopic.title}".`,
                    relevantResults: [],
                  });
                  continue;
                }

                // 2d. Summarize findings (capture text, don't stream to UI)
                const summaryResult = await summarizeFindings(
                  subtopicMessages,
                  extractionResults,
                  sessionId,
                );
                const summaryText = await summaryResult.text;

                subtopicResults.push({
                  subtopic,
                  extractionResults,
                  summaryText,
                  relevantResults: relevantExtractions,
                });

                logger.info("Subtopic completed", {
                  subtopicIndex: subIdx,
                  title: subtopic.title,
                  relevantCount: relevantExtractions.length,
                });
              } catch (error) {
                const errorMsg =
                  error instanceof Error ? error.message : String(error);
                logger.error("Subtopic failed", {
                  subtopicIndex: subIdx,
                  error: errorMsg,
                });
                if (isTimeoutError(error)) {
                  sendAlert(
                    i18n.t("agents.timeoutErrorTitle"),
                    i18n.t("agents.timeoutErrorBody"),
                  );
                }
                subtopicResults.push({
                  subtopic,
                  extractionResults: [],
                  summaryText: `Research for "${subtopic.title}" encountered an error: ${errorMsg}`,
                  relevantResults: [],
                });
              } finally {
                subtopicStatuses[subIdx] = "completed";
                emitDeepPlanStatus(subtopicStatuses);
              }
            }

            // ============================================================
            // Stage 3: Citation Remapping
            // ============================================================
            logger.debug("Stage 3: Remapping citations");
            const { remappedSummaries, globalCitations } =
              buildGlobalCitationsAndRemap(subtopicResults);

            logger.info("Citations remapped", {
              globalCitationCount: globalCitations.length,
            });

            if (globalCitations.length === 0) {
              // No results found across any subtopic
              const noResultStream = streamText({
                model: chatModel(),
                messages,
                system:
                  "You are a research assistant. Inform the user that no relevant search results were found for their query across multiple research subtopics, and suggest they try rephrasing their question.",
                timeout: TIMEOUTS.chat,
                experimental_telemetry: {
                  isEnabled: settingsService.settings.langfuse.enabled,
                  functionId: "deep-research-no-results",
                },
              });
              await mergeStreamAndWait(
                noResultStream.toUIMessageStream({ sendStart: false }),
                writer,
              );
              return;
            }

            // ============================================================
            // Stage 4: Composition (stream final answer to UI)
            // ============================================================
            logger.debug("Stage 4: Composing final answer");

            const subtopicSections = remappedSummaries
              .map(
                ({ subtopic, text }) =>
                  `## Subtopic: ${subtopic.title}\nQuestion: ${subtopic.question}\n\n${text}`,
              )
              .join("\n\n---\n\n");

            const citationTable = globalCitations
              .map((c) => `[${c.globalIndex}] ${c.title} - ${c.url}`)
              .join("\n");

            const compositionMessages: ModelMessage[] = [
              ...messages,
              {
                role: "user" as const,
                content: `Here are the research findings from ${remappedSummaries.length} subtopic investigations:\n\n${subtopicSections}\n\n---\n\nGlobal Citation Index:\n${citationTable}\n\nPlease compose these findings into a comprehensive, well-organized answer.`,
              } as ModelMessage,
            ];

            const compositionResult = streamText({
              model: chatModel(),
              messages: compositionMessages,
              system: compositionSystemPrompt,
              tools: sourceTools,
              timeout: TIMEOUTS.chat,
              experimental_telemetry: {
                isEnabled: settingsService.settings.langfuse.enabled,
                functionId: "deep-research-composer",
              },
            });

            await mergeStreamAndWait(
              compositionResult.toUIMessageStream({ sendStart: false }),
              writer,
            );

            logger.info("Deep research workflow completed successfully");
          } finally {
            await flushTelemetry();
          }
        },
        onError: (error) => {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error("Error in deep research worker", {
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
    { name: "deep-research-worker", endOnExit: false },
  );

  return wrapped() as Promise<ReadableStream<UIMessageChunk>>;
}
