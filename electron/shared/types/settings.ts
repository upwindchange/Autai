/**
 * Settings-related types shared between main and renderer processes
 */

import { z } from 'zod';

// Profile ID schema
export const ProfileIdSchema = z.string().min(1);

// AI Settings schema
export const AISettingsSchema = z.object({
  apiUrl: z.string().url().default('https://api.openai.com/v1'),
  apiKey: z.string().min(1),
  complexModel: z.string().min(1).default('gpt-4'),
  simpleModel: z.string().min(1).default('gpt-3.5-turbo'),
});

export type AISettings = z.infer<typeof AISettingsSchema>;

// Settings Profile schema
export const SettingsProfileSchema = z.object({
  id: ProfileIdSchema,
  name: z.string().min(1),
  settings: AISettingsSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type SettingsProfile = z.infer<typeof SettingsProfileSchema>;

// Settings State schema
export const SettingsStateSchema = z.object({
  profiles: z.array(SettingsProfileSchema),
  activeProfileId: ProfileIdSchema,
});

export type SettingsState = z.infer<typeof SettingsStateSchema>;

// Test Connection Config schema
export const TestConnectionConfigSchema = z.object({
  apiUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

export type TestConnectionConfig = z.infer<typeof TestConnectionConfigSchema>;

// Usage info schema
const UsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

// Test Connection Result schema
export const TestConnectionResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  error: z.string().optional(),
  usage: UsageSchema.optional(),
});

export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;

// Type alias for ProfileId - inferred from schema
export type ProfileId = z.infer<typeof ProfileIdSchema>;
