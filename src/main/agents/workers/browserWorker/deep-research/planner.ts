import { streamText, stepCountIs, type ModelMessage, tool } from "ai";
import { z } from "zod";
import { complexModel } from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@/agents/utils";
import { settingsService } from "@/services";
import type { DeepResearchPlan } from "./types";
import log from "electron-log/main";

const logger = log.scope("deep-research-planner");

// ===== Schema =====

const subtopicSchema = z.object({
  title: z.string().min(1).describe("Short title for this subtopic"),
  question: z
    .string()
    .min(1)
    .describe(
      "A focused research question that can be answered through web search",
    ),
  rationale: z
    .string()
    .min(1)
    .describe(
      "Why this subtopic is necessary for answering the overall question",
    ),
});

const deepResearchPlanSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("Short title for the overall research investigation"),
  researchQuestion: z
    .string()
    .min(1)
    .describe(
      "The high-level research question derived from the user's message",
    ),
  subtopics: z
    .array(subtopicSchema)
    .min(2)
    .describe("Independent subtopics to research (>2, as many as you need)"),
});

// ===== Tool =====

const showDeepResearchPlanTool = tool({
  description: "Generate a deep research plan with independent subtopics",
  inputSchema: deepResearchPlanSchema,
  execute: async (input, { experimental_context }) => {
    const context = experimental_context as { sessionId: string };
    const plan: DeepResearchPlan = {
      id: `deep-plan-${context.sessionId}`,
      title: input.title,
      researchQuestion: input.researchQuestion,
      subtopics: input.subtopics.map((s, index) => ({
        ...s,
        id: `subtopic-${context.sessionId}-${index}`,
      })),
    };
    return plan;
  },
});

// ===== System Prompt =====

const deepPlannerSystemPrompt = `You are a deep research planner. Analyze the user's question and decompose it into independent subtopics (>2, as many as you need) that together provide a comprehensive answer.

## Your Task
1. Understand the full scope of the user's question
2. Identify distinct aspects, angles, or components that each require independent research
3. For each subtopic, write a focused research question that can be answered through web search
4. Explain why each subtopic is necessary

## Subtopic Strategy
- Each subtopic should be answerable through web search independently
- Subtopics should be non-overlapping — do not research the same angle twice
- Cover factual, comparative, historical, analytical, and/or practical aspects as appropriate
- Order subtopics from most fundamental to most advanced/specific

## Output
Call the showDeepResearchPlan tool with your decomposition.`;

// ===== Main Exported Function =====

export async function deepResearchPlanner(
  messages: ModelMessage[],
  sessionId: string,
) {
  logger.debug("Starting deep research planner", {
    sessionId,
    messageCount: messages.length,
  });

  const result = streamText({
    model: complexModel(),
    messages,
    system: deepPlannerSystemPrompt,
    tools: {
      showDeepResearchPlan: showDeepResearchPlanTool,
    },
    toolChoice: {
      type: "tool",
      toolName: "showDeepResearchPlan",
    },
    stopWhen: [
      hasSuccessfulToolResult("showDeepResearchPlan"),
      stepCountIs(20),
    ],
    timeout: TIMEOUTS.planning,
    experimental_context: { sessionId },
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "deep-research-planner",
    },
  });

  result.finishReason.then((reason) => {
    logger.info("Deep research planner stream completed", {
      finishReason: reason,
    });
  });

  return result;
}

export function extractDeepPlanFromSteps(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: any[],
): DeepResearchPlan | undefined {
  const planToolResult = steps
    .flatMap((s) => s.toolResults ?? [])
    .find(
      (tr) =>
        tr.toolName === "showDeepResearchPlan" && tr.type === "tool-result",
    );
  return planToolResult?.output as DeepResearchPlan | undefined;
}
