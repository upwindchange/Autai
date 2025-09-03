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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function repairZodInput<T>(data: any, schema: z.ZodSchema<T>): T {
  // First attempt: direct validation
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }

  // If validation fails, attempt to repair the data
  const repairedData = recursiveRepairData(data, schema);
  
  // Try validation again with repaired data
  const repairedResult = schema.safeParse(repairedData);
  if (repairedResult.success) {
    return repairedResult.data;
  }

  // If repair fails, return the original data (will likely cause UI error but preserves behavior)
  return data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function recursiveRepairData(data: any, schema: z.ZodTypeAny): any {
  // Handle null/undefined
  if (data === null || data === undefined) {
    return data;
  }

  // Handle primitive types
  if (schema instanceof z.ZodString) {
    if (typeof data === 'string') return data;
    return String(data);
  }
  
  if (schema instanceof z.ZodNumber) {
    if (typeof data === 'number') return data;
    const num = Number(data);
    return isNaN(num) ? 0 : num;
  }
  
  if (schema instanceof z.ZodBoolean) {
    if (typeof data === 'boolean') return data;
    return Boolean(data);
  }

  // Handle arrays
  if (schema instanceof z.ZodArray) {
    if (!Array.isArray(data)) {
      // Try to parse as JSON string
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) {
            data = parsed;
          } else {
            // Wrap in array if it's a single object
            data = [parsed];
          }
        } catch {
          // If parsing fails, treat as empty array
          return [];
        }
      } else {
        // Wrap non-array in array
        data = [data];
      }
    }
    
    // Recursively repair each array element
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.map((item: any) =>
      recursiveRepairData(item, schema._def.type)
    );
  }

  // Handle objects
  if (schema instanceof z.ZodObject) {
    if (typeof data !== 'object' || data === null) {
      // Try to parse as JSON string
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          // If parsing fails, return empty object
          return {};
        }
      } else {
        return {};
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {};
    const shape = schema._def.shape();
    
    for (const [key, fieldSchema] of Object.entries(shape)) {
      result[key] = recursiveRepairData(
        data[key],
        fieldSchema as z.ZodTypeAny
      );
    }
    
    return result;
  }

  // Handle unions (like z.optional, z.nullable)
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodOptional) {
    const options = schema instanceof z.ZodUnion 
      ? schema._def.options 
      : [schema._def.innerType];
    
    // Try each option until one works
    for (const option of options) {
      try {
        const repaired = recursiveRepairData(data, option);
        if (repaired !== undefined && repaired !== null) {
          return repaired;
        }
      } catch {
        // Continue to next option
      }
    }
    
    return data;
  }

  // Default: return as-is
  return data;
}