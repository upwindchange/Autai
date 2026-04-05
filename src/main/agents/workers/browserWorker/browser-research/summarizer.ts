import { streamText, type ModelMessage } from "ai";
import { chatModel } from "@agents/providers";
import { settingsService } from "@/services";
import type { ExtractionResult } from "./result-extractor";
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

## Citation Format
- Use numbered citations like [1], [2], etc. inline
- At the end, include a "Sources" section listing all sources
- Format each source as: [N] Title - URL`;

// ===== Main Exported Function =====

export async function summarizeFindings(
  messages: ModelMessage[],
  extractionResults: ExtractionResult[],
  sessionId: string,
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
        result.quotes.length > 0
          ? result.quotes.map((q) => `> "${q}"`).join("\n")
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
