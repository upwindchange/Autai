/**
 * MCP (Model Context Protocol) server configuration types.
 * Shared between main process (service/routes) and renderer (settings/composer).
 *
 * Transport: HTTP and SSE only. Stdio is excluded because sandboxed
 * distribution targets (Mac App Store, Snap, Flatpak) block child
 * process spawning.
 */

import { z } from "zod";

// --- Transport types ---

export const McpTransportTypeSchema = z.enum(["http", "sse"]);
export type McpTransportType = z.infer<typeof McpTransportTypeSchema>;

export const HttpConfigSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type HttpConfig = z.infer<typeof HttpConfigSchema>;

export const SseConfigSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type SseConfig = z.infer<typeof SseConfigSchema>;

// Union of all transport configs
export const McpConnectionConfigSchema = z.union([
  HttpConfigSchema,
  SseConfigSchema,
]);
export type McpConnectionConfig = z.infer<typeof McpConnectionConfigSchema>;

// --- Full server config ---

export const McpServerConfigSchema = z.object({
  id: z.string().optional(), // omitted on create, generated server-side
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  transportType: McpTransportTypeSchema,
  connectionConfig: McpConnectionConfigSchema,
  enabled: z.boolean().default(true),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

// --- Lightweight summary for ComposerAction ---

export const McpServerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
});
export type McpServerSummary = z.infer<typeof McpServerSummarySchema>;

// --- Test connection result ---

export const McpTestResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  toolCount: z.number().optional(),
  toolNames: z.array(z.string()).optional(),
});
export type McpTestResult = z.infer<typeof McpTestResultSchema>;
