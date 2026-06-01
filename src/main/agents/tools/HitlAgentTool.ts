import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { chatModel } from "@agents/providers";
import { hitlTools } from "./HitlTools";
import { settingsService } from "@/services";
import {
  mergeStreamAndWait,
  createToolFilteredStream,
  TIMEOUTS,
} from "@agents/utils";
import type { ToolExecutionContext } from "./types/context";
import log from "electron-log/main";

const logger = log.scope("hitl-agent");

export const HITL_TOOL_NAMES = new Set([
  "askUser",
  "requestHumanIntervention",
  "requestUserInput",
  "requestOptionList",
  "requestQuestionFlow",
]);

const HITL_AGENT_PROMPT = `You are a user interaction specialist. Your job is to communicate with the user on behalf of another AI agent and return their answer as clear, concise text.

# Guidelines

1. Choose the most appropriate tool for the request
2. Write clear, concise prompts/questions - the user should immediately understand what is being asked
3. If presenting options, derive them from context when possible
4. Do NOT ask for passwords, payment details, or sensitive info via requestUserInput - use requestHumanIntervention
5. After receiving the user's response, output ONLY the answer as a concise natural-language summary
6. Do not add commentary, suggestions, or follow-up questions in your final text - just the answer`;

export const askUserTool = tool({
  description:
    "Ask the user for information, a decision, or hands-on help in the browser. " +
    "A sub-agent will pick the best interaction format (text input, option list, multi-step flow, " +
    "or manual browser intervention) based on the context you provide. " +
    "Returns the user's response as free text.",
  inputSchema: z.object({
    request: z
      .string()
      .min(1)
      .describe(
        "What you need from the user to continue the task - could be information, a decision, or a physical action in the browser",
      ),
    context: z
      .string()
      .min(1)
      .describe(
        "Supporting information to determine the best interaction method and content. " +
          "Must include: (1) the current page state — what is visible on screen right now, " +
          "(2) any data, choices, or form elements found on the page that are relevant to the request, " +
          "(3) the overall task goal and why this information is blocking progress. " +
          "Be specific and factual — describe what you see on the page, not what you want the sub-agent to do. " +
          "For choices on the page, list the exact options with labels and details. " +
          "For forms or credentials, describe the fields visible. " +
          "For open-ended needs, describe what is known and what is missing.",
      ),
  }),
  execute: async ({ request, context }, { experimental_context }) => {
    const ctx = experimental_context as ToolExecutionContext;
    const writer = ctx.writer;

    if (!writer) {
      throw new Error(
        "askUser tool requires a stream writer in context - " +
          "it can only be used within streaming workers that pass the writer through experimental_context",
      );
    }

    logger.debug("HITL agent invoked", { request });

    const userMessage =
      context ? `## Request\n${request}\n\n## Context\n${context}` : request;

    const result = streamText({
      model: chatModel(),
      messages: [{ role: "user", content: userMessage }],
      system: HITL_AGENT_PROMPT,
      tools: hitlTools,
      toolChoice: "auto",
      stopWhen: [stepCountIs(10)],
      maxRetries: settingsService.settings.maxRetries,
      timeout: TIMEOUTS.hitlAgent,
      abortSignal: ctx.abortSignal,
      experimental_context: {
        sessionId: ctx.sessionId,
        activeTabId: ctx.activeTabId,
        writer: ctx.writer,
        abortSignal: ctx.abortSignal,
      },
      experimental_telemetry: {
        isEnabled: settingsService.settings.langfuse.enabled,
        functionId: "hitl-agent",
      },
    });

    await mergeStreamAndWait(
      createToolFilteredStream(
        result.toUIMessageStream({ sendStart: false }),
        HITL_TOOL_NAMES,
      ),
      writer,
    );

    const answer = await result.text;

    logger.debug("HITL agent completed", {
      answer: answer.slice(0, 200),
    });

    return { answer };
  },
});
