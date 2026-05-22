import { tool } from "ai";
import { evaluate } from "mathjs";
import { calculateToolSchema } from "@shared/tools";

export const calculateTool = tool({
  description: "Evaluate mathematical expressions using mathjs",
  inputSchema: calculateToolSchema,
  execute: async ({ expression }) => {
    try {
      const result = evaluate(expression);
      return { result: Number(result) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
