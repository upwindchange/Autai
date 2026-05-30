import { tool } from "ai";
import { z } from "zod";
import { HitlService } from "@/services";

export const requestHumanInterventionTool = tool({
  description:
    "Ask the user to take over and perform a physical action in the browser themselves. " +
    "Use when the AI agent cannot complete an action automatically and human hands are required. " +
    "Good for: login forms, CAPTCHAs, two-factor authentication (2FA), entering payment details, " +
    "solving puzzles, completing biometric verification, or any sensitive operation " +
    "requiring human judgment or credentials. " +
    "The user will interact directly with the browser page, then confirm when done. " +
    "Always provide clear `instructions` so the user knows exactly what to do in the browser. " +
    "Do NOT use when: you just need text input from the user (use requestUserInput), " +
    "or the user is choosing from known options (use requestOptionList or requestQuestionFlow).",
  inputSchema: z.object({
    reason: z
      .string()
      .min(1)
      .describe(
        "Why human intervention is needed (e.g., 'Login required', 'CAPTCHA must be solved')",
      ),
    instructions: z
      .string()
      .optional()
      .describe(
        "Specific instructions for the user on what to do in the browser",
      ),
    buttonLabel: z
      .string()
      .optional()
      .describe('Label for the confirmation button. Default: "Done"'),
  }),
  execute: async ({ reason }, { toolCallId, experimental_context }) => {
    const hitlService = HitlService.getInstance();
    const ctx = experimental_context as { abortSignal?: AbortSignal } | undefined;

    const response = await hitlService.request<{
      completed: boolean;
      message?: string;
    }>(toolCallId, undefined, ctx?.abortSignal);

    return {
      completed: response.completed,
      message:
        response.message ??
        (response.completed ?
          "User completed the intervention"
        : "User skipped the intervention"),
      reason,
    };
  },
});

export const requestUserInputTool = tool({
  description:
    "Ask the user a free-form text question and wait for their typed response. " +
    "Use when the answer cannot be predicted or enumerated — the user needs to express " +
    "something in their own words. " +
    "Good for: search queries, explanations, preferences, clarifying ambiguous instructions, " +
    "names, addresses, dates, or any open-ended information. " +
    "Provide `context` to explain why you're asking — it helps the user give a better answer. " +
    "Use `placeholder` to hint at the expected format or content. " +
    "Do NOT use when: the answer is one of a known set of choices (use requestOptionList), " +
    "the user needs to make multiple related selections (use requestQuestionFlow), " +
    "or the user must physically interact with the browser (use requestHumanIntervention).",
  inputSchema: z.object({
    question: z.string().min(1).describe("The question to ask the user"),
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
  execute: async ({ question }, { toolCallId, experimental_context }) => {
    const hitlService = HitlService.getInstance();
    const ctx = experimental_context as { abortSignal?: AbortSignal } | undefined;

    const response = await hitlService.request<{ answer: string }>(toolCallId, undefined, ctx?.abortSignal);

    return {
      answer: response.answer,
      question,
    };
  },
});

export const requestOptionListTool = tool({
  description:
    "Present the user with a list of predefined options to choose from (>1 items). " +
    "Use when you can enumerate the most likely choices, even if the user might have an unexpected answer - " +
    'the user will automatically get an "Other" option with a free-text fallback, so you only need to ' +
    'provide the main candidates. Do NOT include an "Other" or "None of the above" option yourself. ' +
    "Good for: picking a shipping method, choosing a color/size, selecting from search results, " +
    "confirming or rejecting a suggestion, choosing between alternatives found on the page. " +
    "Add a `description` to each option when the label alone might be ambiguous or when extra detail " +
    "helps the user decide (e.g., price, delivery time, pros/cons). " +
    "Supports single-select and multi-select modes. " +
    "Do NOT use when: the answer is **FULLY** open-ended with no reasonable options to suggest (use requestUserInput), " +
    "the user needs to make a series of related decisions across multiple categories " +
    "(use requestQuestionFlow), or the user must physically act in the browser (use requestHumanIntervention).",
  inputSchema: z.object({
    prompt: z
      .string()
      .min(1)
      .describe("A question or prompt describing what the user is choosing"),
    options: z
      .array(
        z.object({
          id: z.string().min(1).describe("Unique identifier for this option"),
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
  execute: async ({ prompt, options }, { toolCallId, experimental_context }) => {
    const hitlService = HitlService.getInstance();
    const ctx = experimental_context as { abortSignal?: AbortSignal } | undefined;

    const response = await hitlService.request<{
      selection: string | string[] | null;
      cancelled: boolean;
    }>(toolCallId, undefined, ctx?.abortSignal);

    if (response.cancelled || response.selection == null) {
      return {
        cancelled: true,
        selection: null,
        prompt,
      };
    }

    const ids =
      Array.isArray(response.selection) ?
        response.selection
      : [response.selection];
    return {
      cancelled: false,
      selection: response.selection,
      prompt,
      selectedOptions: options.filter((opt) => ids.includes(opt.id)),
    };
  },
});

export const requestQuestionFlowTool = tool({
  description:
    "Present the user with a multi-step selection flow (2-5 steps), where each step presents its own set of options. " +
    "Use when the user needs to make a series of related decisions that build on each other - " +
    "each step narrows the choices for the next. " +
    'Like requestOptionList, each step automatically adds an "Other" free-text fallback for the user, ' +
    'so just provide the main candidate options per step. Do NOT include an "Other" option yourself. ' +
    "Good for: product configuration (size → color → material), guided setup wizards, " +
    "multi-filter selection (category → price range → sort order), multi-part surveys. " +
    "Add a `description` to each step and option when extra detail helps the user decide. " +
    "Each step can have single-select or multi-select options, with up to 8 options per step. " +
    "Do NOT use when: only a single choice is needed (use requestOptionList), " +
    "the answer is **FULLY** open-ended with no reasonable options to suggest (use requestUserInput), " +
    "or the user must physically act in the browser (use requestHumanIntervention).",
  inputSchema: z.object({
    prompt: z
      .string()
      .min(1)
      .describe("A description of what the user is choosing across all steps"),
    steps: z
      .array(
        z.object({
          id: z.string().min(1).describe("Unique identifier for this step"),
          title: z.string().min(1).describe("Title displayed for this step"),
          description: z
            .string()
            .optional()
            .describe("Secondary text explaining this step"),
          options: z
            .array(
              z.object({
                id: z
                  .string()
                  .min(1)
                  .describe("Unique identifier for this option"),
                label: z.string().min(1).describe("Display text"),
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
            .describe("Options for this step (max 8)"),
          selectionMode: z
            .enum(["single", "multi"])
            .optional()
            .describe('Selection mode. Default: "single"'),
        }),
      )
      .min(1)
      .max(5)
      .describe("Steps to present (max 5)"),
  }),
  execute: async ({ prompt, steps }, { toolCallId, experimental_context }) => {
    const hitlService = HitlService.getInstance();
    const ctx = experimental_context as { abortSignal?: AbortSignal } | undefined;

    const response = await hitlService.request<{
      answers: Record<string, string[]>;
      cancelled: boolean;
    }>(toolCallId, undefined, ctx?.abortSignal);

    if (response.cancelled) {
      return { cancelled: true, answers: {}, prompt };
    }

    const enrichedSteps = steps.map((step) => {
      const selectedIds = response.answers[step.id] ?? [];
      const knownIds = new Set(step.options.map((o) => o.id));
      return {
        id: step.id,
        title: step.title,
        selectedOptions: step.options.filter((opt) =>
          selectedIds.includes(opt.id),
        ),
        customAnswers: selectedIds.filter((id) => !knownIds.has(id)),
      };
    });

    return {
      cancelled: false,
      answers: response.answers,
      prompt,
      steps: enrichedSteps,
    };
  },
});

export const hitlTools = {
  requestHumanIntervention: requestHumanInterventionTool,
  requestUserInput: requestUserInputTool,
  requestOptionList: requestOptionListTool,
  requestQuestionFlow: requestQuestionFlowTool,
};
