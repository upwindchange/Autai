import { streamText, type ModelMessage } from "ai";
import { chatModel } from "@agents/providers";
import { TIMEOUTS } from "@agents/utils";
import { settingsService } from "@/services";
import type { ExtractionResult } from "./result-extractor";
import type { SearchResultItem } from "./search-agent";
import log from "electron-log/main";

const logger = log.scope("research-summarizer");

// ===== System Prompt =====

const summarizerSystemPrompt = `You are a research assistant. Synthesize the provided research findings into a comprehensive, well-structured answer.

## Guidelines
1. Start with a direct answer to the user's question
2. Support your points with specific information from the research
3. Use inline citations in the format [N] to reference sources
4. When quoting directly, use quotation marks and cite the source
5. Organize information logically (not just by source)
6. If sources conflict, note the disagreement
7. If information is incomplete, acknowledge what you could not find
8. Keep the answer focused and relevant to the original question
9. Do NOT list sources at the end of your response — only use inline [N] citation markers

## Visualization
When your response can benefit from a visual diagram, output a mermaid code block using one of these chart types: Flowchart, Sequence Diagram, Class Diagram, State Diagram, Entity Relationship Diagram, User Journey, Gantt, Pie Chart, Quadrant Chart, Requirement Diagram, GitGraph, C4 Diagram, Mindmap, Timeline, ZenUML, Sankey, XY Chart, Block Diagram, Packet, Kanban, Architecture, Radar, Event Modeling, Treemap, Venn, Ishikawa, Wardley, TreeView

## Citation Format
- Use numbered citations like [1], [2], etc. inline
- Do NOT list sources in the response text — they will be appended automatically

## Math
For inline math expressions, use double dollar signs like $$E = mc^2$$. Never use single dollar signs for math.`;

// ===== Main Exported Function =====

export async function summarizeFindings(
  messages: ModelMessage[],
  extractionResults: ExtractionResult[],
  sessionId: string,
  signal?: AbortSignal,
) {
  logger.debug("Starting summarizer", {
    sessionId,
    extractionCount: extractionResults.length,
    relevantCount: extractionResults.filter((r) => r.relevant).length,
  });

  // Build research context from extraction results
  const relevantResults = extractionResults.filter((r) => r.relevant);

  const researchContext = relevantResults
    .map((result, index) => {
      const quotesText =
        result.quotes.length > 0 ?
          result.quotes.map((q) => `> "${q}"`).join("\n")
        : "No direct quotes extracted.";

      return `### Source [${index + 1}]: ${result.title}
URL: ${result.url}

Summary: ${result.summary}

Key Quotes:
${quotesText}`;
    })
    .join("\n\n---\n\n");

  // Build the user message with research context
  const summaryMessages: ModelMessage[] = [
    ...messages,
    {
      role: "user" as const,
      content: `Here are the research findings from web search:\n\n${researchContext || "No relevant results were found during the research."}\n\nBased on these findings, please provide a comprehensive answer to the original question.`,
    } as ModelMessage,
  ];

  const result = streamText({
    model: chatModel(),
    messages: summaryMessages,
    system: summarizerSystemPrompt,
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.chat,
    abortSignal: signal,
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "research-summarizer",
    },
  });

  result.finishReason.then((reason) => {
    logger.info("Summarizer stream completed", { finishReason: reason });
  });

  return result;
}

// ===== Quick Search Variant =====

export async function summarizeFindingsFromSnippets(
  messages: ModelMessage[],
  searchResults: SearchResultItem[],
  sessionId: string,
  signal?: AbortSignal,
) {
  logger.debug("Starting quick summarizer", {
    sessionId,
    resultCount: searchResults.length,
  });

  const researchContext = searchResults
    .map((result, index) => {
      return `### Source [${index + 1}]: ${result.title}
URL: ${result.url}

Snippet: ${result.snippet}`;
    })
    .join("\n\n---\n\n");

  const summaryMessages: ModelMessage[] = [
    ...messages,
    {
      role: "user" as const,
      content: `Here are the web search results:\n\n${researchContext || "No relevant results were found during the search."}\n\nBased on these results, please answer the original question.`,
    } as ModelMessage,
  ];

  const result = streamText({
    model: chatModel(),
    messages: summaryMessages,
    system: summarizerSystemPrompt,
    maxRetries: settingsService.settings.maxRetries,
    timeout: TIMEOUTS.chat,
    abortSignal: signal,
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "research-summarizer-quick",
    },
  });

  result.finishReason.then((reason) => {
    logger.info("Quick summarizer stream completed", { finishReason: reason });
  });

  return result;
}
