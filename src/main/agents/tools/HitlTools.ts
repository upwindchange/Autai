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

export const requestOptionListTool = tool({
  description:
    "Present the user with a list of options to choose from. " +
    "Use this when the user needs to select from a known set of choices, " +
    "such as picking a shipping method, choosing a color, selecting from search results, " +
    "or deciding between multiple alternatives. " +
    "Supports both single-select and multi-select modes.",
  inputSchema: z.object({
    prompt: z
      .string()
      .min(1)
      .describe(
        "A question or prompt describing what the user is choosing",
      ),
    options: z
      .array(
        z.object({
          id: z
            .string()
            .min(1)
            .describe("Unique identifier for this option"),
          label: z.string().min(1).describe("Display text for this option"),
          description: z
            .string()
            .optional()
            .describe("Secondary text explaining this option"),
          disabled: z
            .boolean()
            .optional()
            .describe("Whether this option is non-selectable"),
        }),
      )
      .min(1)
      .max(8)
      .describe("The options to present (max 8 for readability)"),
    selectionMode: z
      .enum(["single", "multi"])
      .optional()
      .describe('Selection mode. Default: "single"'),
    minSelections: z
      .number()
      .min(0)
      .optional()
      .describe("Minimum selections required (default: 1)"),
    maxSelections: z
      .number()
      .min(1)
      .optional()
      .describe("Maximum selections allowed (multi-select only)"),
    defaultValue: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe("Pre-selected option ID(s)"),
  }),
  execute: async ({ prompt, options }, { toolCallId }) => {
    const hitlService = HitlService.getInstance();

    const response = await hitlService.request<{
      selection: string | string[] | null;
      cancelled: boolean;
    }>(toolCallId);

    if (response.cancelled || response.selection == null) {
      return {
        cancelled: true,
        selection: null,
        prompt,
      };
    }

    const ids = Array.isArray(response.selection)
      ? response.selection
      : [response.selection];
    return {
      cancelled: false,
      selection: response.selection,
      prompt,
      selectedOptions: options.filter((opt) => ids.includes(opt.id)),
    };
  },
});

export const hitlTools = {
  requestHumanIntervention: requestHumanInterventionTool,
  requestUserInput: requestUserInputTool,
  requestOptionList: requestOptionListTool,
};
