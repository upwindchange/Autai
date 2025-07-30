import { z } from "zod";

// Define tool parameter schemas that can be shared
export const calculateToolSchema = z.object({
  expression: z.string(),
});

export const answerToolSchema = z.object({
  steps: z.array(
    z.object({
      calculation: z.string(),
      reasoning: z.string(),
    })
  ),
  answer: z.string(),
});

export const displayErrorToolSchema = z.object({
  title: z.string().describe("Short error title"),
  message: z.string().describe("Detailed error message"),
  details: z.string().optional().describe("Technical details or error codes"),
});

// Type inference for parameters and results
export type CalculateToolParams = z.infer<typeof calculateToolSchema>;
export type CalculateToolResult = number | string; // mathjs result or error string

export type AnswerToolParams = z.infer<typeof answerToolSchema>;
export type AnswerToolResult = void; // no execute function

export type DisplayErrorToolParams = z.infer<typeof displayErrorToolSchema>;
export type DisplayErrorToolResult = {
  type: "error";
  title: string;
  message: string;
  timestamp: string;
  details?: string;
};

// Union types for all tools
export type ToolParams = 
  | { name: "calculate"; params: CalculateToolParams }
  | { name: "answer"; params: AnswerToolParams }
  | { name: "displayError"; params: DisplayErrorToolParams };

export type ToolResults = 
  | { name: "calculate"; result: CalculateToolResult }
  | { name: "answer"; result: AnswerToolResult }
  | { name: "displayError"; result: DisplayErrorToolResult };

// Tool names as const
export const TOOL_NAMES = {
  CALCULATE: "calculate",
  ANSWER: "answer",
  DISPLAY_ERROR: "displayError",
} as const;

export type ToolName = typeof TOOL_NAMES[keyof typeof TOOL_NAMES];