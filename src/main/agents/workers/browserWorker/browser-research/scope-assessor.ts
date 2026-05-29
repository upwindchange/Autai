import { streamText, stepCountIs, type ModelMessage } from "ai";
import { complexModel } from "@agents/providers";
import { TIMEOUTS } from "@agents/utils";
import { askUserTool } from "@agents/tools/HitlAgentTool";
import { settingsService } from "@/services";
import log from "electron-log/main";

const logger = log.scope("research-scope-assessor");

// ===== System Prompt =====

const SCOPE_ASSESSOR_PROMPT = `You are a research scope assessor. You evaluate whether a user's research question needs clarification before proceeding with a deep research plan.

## Your Task
Given the user's original question and a pre-research summary of what was found, decide whether clarification is needed.

## When to Ask (use the askUser tool)
Call the askUser tool ONLY when you identify one or more of these situations:
- **Scope creep**: The pre-research reveals the topic is much broader than the question suggests, with many possible sub-topics the user might or might not care about
- **Ambiguous direction**: The question could be interpreted in multiple valid ways (e.g., "best framework" — for what? web? mobile? data science?)
- **Missing constraints**: Key constraints like budget, region, time period, skill level, or use case are absent but would significantly change the research direction
- **Unexpected complexity**: The pre-research revealed unexpected dimensions, trade-offs, or related areas that the user may not be aware of
- **Multiple research paths**: There are several distinct and incompatible research directions, and the user's preference is unclear

## When NOT to Ask
Do NOT call the askUser tool when:
- The question is specific and well-defined
- The pre-research confirms a clear research direction
- The answer can be found without further narrowing
- The ambiguity is minor and reasonable assumptions can be made

## How to Ask
When you decide clarification is needed:
- Be concise and specific about what you need to know
- Present options when there are clear choices (e.g., "Are you interested in A, B, or C?")
- Focus on the most critical clarification first
- Keep the request brief — the user should immediately understand what is being asked

## Output
- If clarification is needed: Call the askUser tool with a clear, specific question
- If no clarification is needed: Simply respond with "NO_CLARIFICATION_NEEDED" and a brief one-sentence reason why the scope is clear`;

// ===== Main Exported Function =====

export async function assessAndClarifyScope(
  messages: ModelMessage[],
  preResearchSummary: string,
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writer: { write: (chunk: any) => void },
): Promise<{ hitlAnswer: string | null }> {
  logger.debug("Starting scope assessment", { sessionId });

  // Build the user message with pre-research context
  const userQuestion = extractUserQuestion(messages);

  const assessorMessages: ModelMessage[] = [
    {
      role: "user",
      content: `## Original User Question\n${userQuestion}\n\n## Pre-Research Summary\n${preResearchSummary}\n\nBased on the user's question and the pre-research findings above, evaluate whether clarification is needed before proceeding with a detailed research plan.`,
    } as ModelMessage,
  ];

  const result = streamText({
    model: complexModel(),
    messages: assessorMessages,
    system: SCOPE_ASSESSOR_PROMPT,
    tools: {
      askUser: askUserTool,
    },
    toolChoice: "auto",
    stopWhen: [stepCountIs(10)],
    timeout: TIMEOUTS.hitlAgent,
    experimental_context: {
      sessionId,
      writer,
    },
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "research-scope-assessor",
    },
  });

  // Wait for stream to complete and extract results (same pattern as planner)
  const steps = await result.steps;

  // Check if askUser tool was called
  const askUserResult = steps
    .flatMap((s) => s.toolResults ?? [])
    .find(
      (tr) => tr.toolName === "askUser" && tr.type === "tool-result",
    );

  if (askUserResult) {
    const output = askUserResult.output as { answer: string } | undefined;
    const answer = output?.answer ?? null;

    logger.debug("HITL clarification completed", {
      answerLength: answer?.length ?? 0,
    });

    return { hitlAnswer: answer };
  }

  logger.debug("No clarification needed — proceeding with research plan");
  return { hitlAnswer: null };
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
              part.type === "text",
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
