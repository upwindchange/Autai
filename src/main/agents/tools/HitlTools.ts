import { tool } from "ai";
import { z } from "zod";
import { HitlService } from "@/services";

export const requestHumanInterventionTool = tool({
  description:
    "Request human intervention when you encounter an operation that cannot be automated, " +
    "such as login forms, CAPTCHAs, two-factor authentication, payment information, " +
    "or any other interaction requiring human judgment or credentials. " +
    "The user will perform the action in the browser, then confirm when finished.",
  inputSchema: z.object({
    reason: z
      .string()
      .min(1)
      .describe(
        "Why human intervention is needed (e.g., 'Login required', 'CAPTCHA must be solved')"
      ),
    instructions: z
      .string()
      .optional()
      .describe(
        "Specific instructions for the user on what to do in the browser"
      ),
    buttonLabel: z
      .string()
      .optional()
      .describe(
        'Label for the confirmation button. Default: "Done"'
      ),
  }),
  execute: async (
    { reason, instructions, buttonLabel },
    { toolCallId },
  ) => {
    const hitlService = HitlService.getInstance();

    const response = await hitlService.request<{
      completed: boolean;
      message?: string;
    }>(toolCallId);

    return {
      completed: response.completed,
      message: response.message ?? (response.completed
        ? "User completed the intervention"
        : "User skipped the intervention"),
      reason,
    };
  },
});

export const requestUserInputTool = tool({
  description:
    "Ask the user a question and wait for their text response. " +
    "Use this when you need information that cannot be determined from the page, " +
    "such as login credentials, search queries, preferences, or clarification on ambiguous instructions. " +
    "The user's text answer will be returned so you can continue the task.",
  inputSchema: z.object({
    question: z
      .string()
      .min(1)
      .describe("The question to ask the user"),
    context: z
      .string()
      .optional()
      .describe("Why this information is needed (shown as secondary text)"),
    placeholder: z
      .string()
      .optional()
      .describe("Placeholder text for the input field"),
    buttonLabel: z
      .string()
      .optional()
      .describe('Label for the submit button. Default: "Submit"'),
  }),
  execute: async (
    { question },
    { toolCallId },
  ) => {
    const hitlService = HitlService.getInstance();

    const response = await hitlService.request<{ answer: string }>(toolCallId);

    return {
      answer: response.answer,
      question,
    };
  },
});

export const hitlTools = {
  requestHumanIntervention: requestHumanInterventionTool,
  requestUserInput: requestUserInputTool,
};
