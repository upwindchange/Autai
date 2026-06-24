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
  mode: z.enum(["chat", "entertainment"]).optional(),
});

// Per-thread chat model override (null providerId/modelId = use the global default)
export const ThreadChatOverrideSchema = z.object({
  providerId: z.string().min(1).nullable(),
  modelId: z.string().min(1).nullable(),
});

// Thread update schema
export const UpdateThreadSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(["archived", "regular"]).optional(),
  chatOverride: ThreadChatOverrideSchema.optional(),
});

// Tag creation schema
export const CreateTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  sortOrder: z.number().int().optional(),
  mode: z.enum(["chat", "entertainment"]).optional(),
});

// Tag update schema
export const UpdateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
}).refine((data) => data.name !== undefined || data.color !== undefined, {
  message: "At least one of name or color must be provided",
});

// Add tag to thread schema
export const AddThreadTagSchema = z.object({
  tagId: z.number().int().positive(),
});

// Reuse existing schemas for settings endpoints
export { SettingsStateSchema, TestConnectionConfigSchema };
