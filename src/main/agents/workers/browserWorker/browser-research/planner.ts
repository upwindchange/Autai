import { streamText, stepCountIs, ModelMessage, tool } from "ai";
import { z } from "zod";
import { complexModel } from "@agents/providers";
import { hasSuccessfulToolResult, TIMEOUTS } from "@/agents/utils";
import { settingsService } from "@/services";
import log from "electron-log/main";

const logger = log.scope("research-planner");

// ===== Result Types =====

export interface ResearchQuery {
  id: string;
  query: string;
  focus: string;
}

export interface ResearchPlan {
  id: string;
  title: string;
  description: string;
  queries: ResearchQuery[];
}

// ===== Plan Schema =====

const researchQuerySchema = z.object({
  query: z.string().min(1).describe("The Google search query string"),
  focus: z
    .string()
    .min(1)
    .describe(
      "What specific information to look for when analyzing results for this query",
    ),
});

const researchPlanSchema = z.object({
  title: z.string().min(1).describe("Short title for this research plan"),
  description: z.string().min(1).describe("What the user wants to find out"),
  queries: z
    .array(researchQuerySchema)
    .min(1)
    .max(5)
    .describe("Search queries to execute (1-5)"),
});

// ===== Tool Definition =====

const showResearchPlanTool = tool({
  description: "Generate a web research plan with search queries",
  inputSchema: researchPlanSchema,
  execute: async (input, { experimental_context }) => {
    const context = experimental_context as { sessionId: string };
    const plan = {
      ...input,
      id: `research-plan-${context.sessionId}`,
      queries: input.queries.map((q, index) => ({
        ...q,
        id: `research-query-${context.sessionId}-${index}`,
      })),
    };
    return plan as ResearchPlan;
  },
});

// ===== System Prompt =====

const plannerSystemPrompt = `You are a web research planner. Analyze the user's question and create a focused research plan.

## Your Task
1. Understand what information the user needs
2. Identify the key aspects to research
3. Generate 1-5 Google search queries that will find the most relevant information
4. For each query, specify what specific information to look for

## Query Strategy
- Start broad, then go specific
- Use precise terms that will yield authoritative results
- Different angles/perspectives for complex topics
- Include technical terms when appropriate
- Keep queries concise (Google works best with short, targeted queries)

## Output
Call the showResearchPlan tool with your research plan.`;

// ===== Enrichment Options =====

export interface PlannerEnrichment {
  preResearchSummary?: string;
  hitlAnswer?: string;
}

// ===== Main Exported Function =====

export async function researchPlanner(
  messages: ModelMessage[],
  sessionId: string,
  enrichment?: PlannerEnrichment,
) {
  logger.debug("Starting research planner", {
    sessionId,
    messageCount: messages.length,
    hasPreResearch: !!enrichment?.preResearchSummary,
    hasHitlAnswer: !!enrichment?.hitlAnswer,
  });

  // Build enriched messages if additional context is provided
  const enrichedMessages: ModelMessage[] = [...messages];
  if (enrichment?.preResearchSummary || enrichment?.hitlAnswer) {
    const contextParts: string[] = [];
    if (enrichment.preResearchSummary) {
      contextParts.push(
        `## Pre-Research Findings\n${enrichment.preResearchSummary}\n\nUse these findings to refine your research queries and focus on areas that need deeper investigation.`,
      );
    }
    if (enrichment.hitlAnswer) {
      contextParts.push(
        `## User Clarification\n${enrichment.hitlAnswer}\n\nIncorporate this clarification into your research plan.`,
      );
    }
    enrichedMessages.push({
      role: "user",
      content: contextParts.join("\n\n"),
    } as ModelMessage);
  }

  const result = streamText({
    model: complexModel(),
    messages: enrichedMessages,
    system: plannerSystemPrompt,
    tools: {
      showResearchPlan: showResearchPlanTool,
    },
    toolChoice: {
      type: "tool",
      toolName: "showResearchPlan",
    },
    stopWhen: [hasSuccessfulToolResult("showResearchPlan"), stepCountIs(20)],
    timeout: TIMEOUTS.planning,
    experimental_context: { sessionId },
    experimental_telemetry: {
      isEnabled: settingsService.settings.langfuse.enabled,
      functionId: "research-planner",
    },
  });

  result.finishReason.then((reason) => {
    logger.info("Research planner stream completed", { finishReason: reason });
  });

  return result;
}
