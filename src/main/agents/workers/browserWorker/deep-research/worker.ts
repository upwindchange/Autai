import {
  streamText,
  createUIMessageStream,
  stepCountIs,
  type LanguageModel,
  type UIMessageChunk,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { settingsService, SessionTabService } from "@/services";
import { i18n } from "@/i18n";
import { sendAlert } from "@/utils/messageUtils";
import { flushTelemetry } from "@/agents/utils/telemetry";
import log from "electron-log/main";
import { observe } from "@langfuse/tracing";
import { deepResearchPlanner } from "./planner";
import type { DeepResearchPlan } from "./types";
import { researchPlanner } from "../browser-research/planner";
import type { ResearchPlan } from "../browser-research/planner";
import { executeSearchQueries } from "../browser-research/search-agent";
import { extractResultsFromUrls } from "../browser-research/result-extractor";
import { summarizeFindings } from "../browser-research/summarizer";
import { askUserTool } from "@agents/tools/HitlAgentTool";
import { runPreResearch } from "./pre-research";
import {
  mergeStreamAndWait,
  writeSimulatedToolCallToStream,
  retryStreamTextForTool,
  TIMEOUTS,
  isAbortError,
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
8. Do NOT list a references section at the end — only use inline [N] citation markers. A reference list will be appended automatically.

## Structure
- Start with a table of contents
- Use journal article format
- Use the abstract section to briefly answer the user's question
- Organize information logically by theme
- Use headers or sections
- End with a brief conclusion

## Visualization
When your response can benefit from a visual diagram, output a mermaid code block using one of these chart types: Flowchart, Sequence Diagram, Class Diagram, State Diagram, Entity Relationship Diagram, User Journey, Gantt, Pie Chart, Quadrant Chart, Requirement Diagram, GitGraph, C4 Diagram, Mindmap, Timeline, ZenUML, Sankey, XY Chart, Block Diagram, Packet, Kanban, Architecture, Radar, Event Modeling, Treemap, Venn, Ishikawa, Wardley, TreeView

## Math
For inline math expressions, use double dollar signs like $$E = mc^2$$. Never use single dollar signs for math.`;

// ===== HITL Decision System Prompt =====

const hitlDecisionSystemPrompt = `You are a research scope evaluator. You are given a user's research question and a summary of initial web research findings.

## Your Task
Analyze whether the research question has ambiguities, scope creep, undefined areas, or unclear direction that would benefit from user clarification before decomposing into a detailed research plan.

## When to Ask the User
- The question is vague (e.g., "research AI" without specifying what aspect)
- Multiple valid interpretations exist (e.g., "best framework" for what language/use-case?)
- Critical constraints are unknown (budget, region, timeframe, target audience)
- The pre-research reveals the topic is much broader than the question implies
- Technical vs. non-technical audience is unclear

## When NOT to Ask the User
- The question is specific enough to decompose unambiguously
- The pre-research provides sufficient context to understand the scope
- Any ambiguity is minor and can be handled by covering multiple angles in subtopics
- The question is straightforward factual research

## If You Decide to Ask
Call the askUser tool with a concise question that resolves the key ambiguity. Focus on the single most important clarification needed.

## If You Decide NOT to Ask
Simply respond with "NO_CLARIFICATION_NEEDED" and nothing else. Do not call any tool.`;

// ===== Plan Extraction Helper =====

async function extractPlanFromPlannerWithRetry(
  messages: ModelMessage[],
  sessionId: string,
  signal: AbortSignal | undefined,
  maxRetries: number,
): Promise<ResearchPlan> {
  const plan = await retryStreamTextForTool(
    () => researchPlanner(messages, sessionId, signal),
    "showResearchPlan",
    (output) => output as ResearchPlan,
    { maxAttempts: maxRetries, logger },
  );
  if (!plan) {
    throw new Error(
      "Failed to generate research plan: showResearchPlan tool not called after retries",
    );
  }
  return plan;
}

// ===== Main Exported Function =====

export async function browserDeepResearchWorker(
  messages: ModelMessage[],
  sessionId: string,
  originalMessages: UIMessage[],
  chatLanguageModel: LanguageModel,
  onFinish?: (messages: UIMessage[]) => void,
  signal?: AbortSignal,
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
            const maxRetries = settingsService.settings.maxRetries;

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
            // Stage 0: Pre-Research (quick scan for context)
            // ============================================================
            logger.debug("Stage 0: Running pre-research scan");

            const preResearchResult = await runPreResearch(
              messages,
              sessionId,
              tabId,
              writer,
              chatLanguageModel,
              signal,
            );

            logger.info("Pre-research completed", {
              resultCount: preResearchResult.searchResults.length,
              summaryLength: preResearchResult.summaryText.length,
            });

            // ============================================================
            // Stage 0.5: HITL Clarification (optional)
            // ============================================================
            let hitlAnswer: string | null = null;

            if (preResearchResult.summaryText.length > 0) {
              logger.debug(
                "Stage 0.5: Evaluating if clarification is needed",
              );

              // Abort guard: skip HITL if already cancelled
              if (signal?.aborted) {
                logger.info("Deep research aborted before HITL decision");
                throw new DOMException("Aborted", "AbortError");
              }

              // Extract user text from messages for the decision prompt
              const userText = messages
                .filter((m) => m.role === "user")
                .map((m) =>
                  typeof m.content === "string" ?
                    m.content
                  : Array.isArray(m.content) ?
                    m.content
                      .filter(
                        (p): p is { type: "text"; text: string } =>
                          "type" in p && p.type === "text",
                      )
                      .map((p) => p.text)
                      .join("\n")
                  : "",
                )
                .join("\n");

              const hitlDecisionMessages: ModelMessage[] = [
                {
                  role: "user" as const,
                  content: `## Research Question\n${userText}\n\n## Pre-Research Summary\n${preResearchResult.summaryText}`,
                } as ModelMessage,
              ];

              const hitlResult = streamText({
                model: chatLanguageModel,
                messages: hitlDecisionMessages,
                system: hitlDecisionSystemPrompt,
                tools: {
                  askUser: askUserTool,
                },
                toolChoice: "auto",
                stopWhen: [stepCountIs(3)],
                maxRetries,
                timeout: TIMEOUTS.hitlAgent,
                abortSignal: signal,
                experimental_context: {
                  sessionId,
                  writer,
                  chatModel: chatLanguageModel,
                  abortSignal: signal,
                },
                experimental_telemetry: {
                  isEnabled: settingsService.settings.langfuse.enabled,
                  functionId: "deep-research-hitl-decision",
                },
              });

              // Wait for completion — do NOT merge the main stream into the
              // writer. Only the askUserTool's internal HITL stream (option
              // lists, input forms) should appear in the UI.
              await hitlResult.text;

              const hitlSteps = await hitlResult.steps;
              const askUserResult = hitlSteps
                .flatMap((s) => s.toolResults ?? [])
                .find(
                  (tr) =>
                    tr.toolName === "askUser" && tr.type === "tool-result",
                );

              if (askUserResult) {
                const output = askUserResult.output as
                  | { answer: string }
                  | undefined;
                hitlAnswer = output?.answer ?? null;
                logger.info("HITL clarification received", {
                  answerLength: hitlAnswer?.length ?? 0,
                });
              } else {
                logger.debug("No HITL clarification needed");
              }
            }

            // ============================================================
            // Stage 1: Deep Research Planning (decompose into subtopics)
            // ============================================================

            // Build enriched messages with pre-research context and optional
            // HITL answer compiled into a single supplementary block
            const enrichedMessages: ModelMessage[] = [];
            const contextParts: string[] = [];

            if (preResearchResult.summaryText.length > 0) {
              contextParts.push(
                `## Pre-Research Context\nA quick web scan was performed. Here is a summary of initial findings:\n\n${preResearchResult.summaryText}`,
              );
            }
            if (hitlAnswer) {
              contextParts.push(
                `## User Clarification\nThe user provided this clarification:\n\n${hitlAnswer}`,
              );
            }

            if (contextParts.length > 0) {
              enrichedMessages.push(
                {
                  role: "user" as const,
                  content: contextParts.join("\n\n"),
                } as ModelMessage,
                {
                  role: "assistant" as const,
                  content:
                    "Understood. I will incorporate this context into the research plan.",
                } as ModelMessage,
              );
            }

            enrichedMessages.push(...messages);

            logger.debug("Stage 1: Generating deep research plan");

            const deepPlan = await retryStreamTextForTool(
              () => deepResearchPlanner(enrichedMessages, sessionId, signal),
              "showDeepResearchPlan",
              (output) => output as DeepResearchPlan,
              { maxAttempts: maxRetries, logger },
            );

            if (!deepPlan) {
              logger.error("Failed to generate deep research plan after retries");
              throw new Error(
                "Failed to generate deep research plan: showDeepResearchPlan tool not called after retries",
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
              // Abort guard: stop processing subtopics if cancelled
              if (signal?.aborted) {
                logger.info("Deep research aborted during subtopic loop", {
                  subtopicIndex: subIdx,
                });
                break;
              }

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

                const plan = await extractPlanFromPlannerWithRetry(
                  subtopicMessages,
                  sessionId,
                  signal,
                  maxRetries,
                );

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
                  signal,
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
                  signal,
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
                  chatLanguageModel,
                  signal,
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
                model: chatLanguageModel,
                messages,
                system:
                  "You are a research assistant. Inform the user that no relevant search results were found for their query across multiple research subtopics, and suggest they try rephrasing their question.",
                maxRetries,
                timeout: TIMEOUTS.chat,
                abortSignal: signal,
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

            const compositionMessages: ModelMessage[] = [
              ...messages,
              {
                role: "user" as const,
                content: `Here are the research findings from ${remappedSummaries.length} subtopic investigations:\n\n${subtopicSections}\n\nPlease compose these findings into a comprehensive, well-organized answer.`,
              } as ModelMessage,
            ];

            const compositionResult = streamText({
              model: chatLanguageModel,
              messages: compositionMessages,
              system: compositionSystemPrompt,
              maxRetries,
              timeout: TIMEOUTS.chat,
              abortSignal: signal,
              experimental_telemetry: {
                isEnabled: settingsService.settings.langfuse.enabled,
                functionId: "deep-research-composer",
              },
            });

            await mergeStreamAndWait(
              compositionResult.toUIMessageStream({ sendStart: false }),
              writer,
            );

            // Append references to the markdown body
            const referenceList = globalCitations
              .map((c) => `[${c.globalIndex}] ${c.title} - ${c.url}`)
              .join("\n");
            const refId = "text-references";
            writer.write({ type: "text-start", id: refId });
            writer.write({
              type: "text-delta",
              id: refId,
              delta: `\n\n<details>\n<summary>References</summary>\n\n${referenceList}\n\n</details>`,
            });
            writer.write({ type: "text-end", id: refId });

            // Present sources as a separate tool card
            const presentableSources = globalCitations.map((c) => ({
              url: c.url,
              title: c.title,
            }));
            writeSimulatedToolCallToStream({
              writer,
              toolCallId: `deep-sources-${sessionId}`,
              toolName: "presentSources",
              input: { sources: presentableSources },
              output: { sources: presentableSources },
            });

            logger.info("Deep research workflow completed successfully");
          } finally {
            await flushTelemetry();
          }
        },
        onError: (error) => {
          if (isAbortError(error)) {
            logger.info("Deep research worker cancelled by user");
            return "";
          }
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
