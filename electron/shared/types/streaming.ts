/**
 * Streaming-related types shared between main and renderer processes
 */

import { z } from 'zod';
import { TaskIdSchema } from './core';

// Stream chunk type schema
export const StreamChunkTypeSchema = z.enum(["token", "error", "metadata", "tool_call"]);

// Stream Chunk schema
export const StreamChunkSchema = z.object({
  type: StreamChunkTypeSchema,
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type StreamChunk = z.infer<typeof StreamChunkSchema>;

// Streaming Agent Config schema
export const StreamingAgentConfigSchema = z.object({
  taskId: TaskIdSchema,
  apiUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

export type StreamingAgentConfig = z.infer<typeof StreamingAgentConfigSchema>;

// Agent Stream Options schema
export const AgentStreamOptionsSchema = z.object({
  message: z.string().min(1),
});

export type AgentStreamOptions = z.infer<typeof AgentStreamOptionsSchema>;
