import { z } from "zod";
import { SettingsStateSchema, TestConnectionConfigSchema } from "@shared";

// Chat request body schema
export const ChatRequestSchema = z.object({
  id: z.string().optional(),
  messages: z.array(z.any()), // UIMessage[] - structurally validated by AI SDK
  system: z.string().optional(),
  tools: z.any().optional(), // ToolSet[] - complex, validated at runtime
});

// Thread creation schema
export const CreateThreadSchema = z.object({
  id: z.string().min(1),
});

// Thread update schema
export const UpdateThreadSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(["archived", "regular"]).optional(),
});

// Reuse existing schemas for settings endpoints
export { SettingsStateSchema, TestConnectionConfigSchema };
