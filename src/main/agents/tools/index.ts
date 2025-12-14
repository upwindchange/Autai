import { tool } from "ai";
import { z } from "zod";
import { evaluate } from "mathjs";
import { interactiveTools } from "./InteractiveTools";

export const backendTools = {
  ...interactiveTools,
  calculate: tool({
    description: "Evaluate mathematical expressions using mathjs",
    inputSchema: z.object({
      expression: z.string(),
    }),
    execute: async ({ expression }) => {
      try {
        const result = evaluate(expression);
        return { result: Number(result) };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
  }),

  answer: tool({
    description: "Provide the final answer with reasoning steps",
    inputSchema: z.object({
      steps: z.array(z.object({
        calculation: z.string(),
        reasoning: z.string(),
      })),
      answer: z.string(),
    }),
    // No execute needed - this is a UI-only tool
  }),
};