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

const HITL_TOOL_NAMES = new Set([
  "requestHumanIntervention",
  "requestUserInput",
  "requestOptionList",
  "requestQuestionFlow",
]);

const HITL_AGENT_PROMPT = `You are a user interaction specialist. Your job is to communicate with the user on behalf of another AI agent and return their answer as clear, concise text.

# Available Tools

## requestUserInput
Ask a free-form text question. Use when:
- The answer is open-ended text
- You don't know the possible answers in advance
- You need clarification on ambiguous instructions

## requestOptionList
Present a list of choices. Use when:
- The valid answers form a small, known set (2–8 options)
- You can enumerate the choices
- The user needs to pick one or more from a list

## requestQuestionFlow
Present a multi-step selection flow. Use when:
- The user needs to make a series of related decisions
- Each step has a distinct set of options
- The choices build on each other (e.g., pick size → color → material)

## requestHumanIntervention
Ask the user to perform a physical action in the browser. Use when:
- Login forms, CAPTCHAs, 2FA are required
- Payment information must be entered
- Any sensitive operation requiring human judgment or credentials

# Guidelines

1. Choose the most appropriate tool for the request
2. Write clear, concise prompts/questions — the user should immediately understand what is being asked
3. If presenting options, derive them from context when possible
4. Do NOT ask for passwords, payment details, or sensitive info via requestUserInput — use requestHumanIntervention
5. After receiving the user's response, output ONLY the answer as a concise natural-language summary
6. Do not add commentary, suggestions, or follow-up questions in your final text — just the answer`;

export const askUserTool = tool({
  description:
    "Interact with the user to get information, feedback, or a decision. " +
    "The tool will automatically choose the best interaction method (text input, multiple choice, " +
    "multi-step flow, or hands-on browser intervention) based on the request. " +
    "Returns the user's answer as free text.",
  inputSchema: z.object({
    request: z
      .string()
      .min(1)
      .describe(
        "What you need from the user (e.g., 'Which shipping method do they prefer?', 'Ask for their login credentials')",
      ),
    context: z
      .string()
      .optional()
      .describe(
        "Why this information is needed or relevant context from the current task",
      ),
  }),
  execute: async ({ request, context }, { experimental_context }) => {
    const ctx = experimental_context as ToolExecutionContext;
    const writer = ctx.writer;

    if (!writer) {
      throw new Error(
        "askUser tool requires a stream writer in context — " +
          "it can only be used within streaming workers that pass the writer through experimental_context",
      );
    }

    logger.debug("HITL agent invoked", { request });

    const userMessage = context ?
      `## Request\n${request}\n\n## Context\n${context}`
    : request;

    const result = streamText({
      model: chatModel(),
      messages: [{ role: "user", content: userMessage }],
      system: HITL_AGENT_PROMPT,
      tools: hitlTools,
      toolChoice: "auto",
      stopWhen: [stepCountIs(10)],
      timeout: TIMEOUTS.hitlAgent,
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
