/**
 * Core data types shared between main and renderer processes
 */

import { z } from "zod";

// Base ID schemas for type safety
export const TaskIdSchema = z.string().min(1);
export const PageIdSchema = z.string().min(1);
export const ViewIdSchema = z.string().min(1);
export const AgentIdSchema = z.string().min(1);

// Define Page schema as the source of truth
export const PageSchema = z.object({
  id: PageIdSchema,
  url: z.string().url().or(z.string().min(1)), // Allow non-URL strings for special pages
  title: z.string(),
  favicon: z.string(),
});

// Derive Page type from schema
export type Page = z.infer<typeof PageSchema>;

// Schema for validating page updates (partial, without id)
export const PageUpdateSchema = PageSchema.omit({ id: true }).partial().strict().refine(
  (data) => !data.url || data.url.length > 0,
  { message: "URL cannot be empty if provided", path: ["url"] }
);

// Task schema
export const TaskSchema = z.object({
  id: TaskIdSchema,
  title: z.string(),
  pages: z.map(PageIdSchema, PageSchema),
  activePageId: PageIdSchema.nullable(),
});

export type Task = z.infer<typeof TaskSchema>;

// View schema
export const ViewSchema = z.object({
  id: ViewIdSchema,
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
});

export type View = z.infer<typeof ViewSchema>;

// Agent schema
export const AgentStatusSchema = z.enum(["idle", "processing", "error", "terminated"]);

export const AgentSchema = z.object({
  id: AgentIdSchema,
  taskId: TaskIdSchema,
  processId: z.number().int().positive(),
  status: AgentStatusSchema,
  createdAt: z.number(), // Unix timestamp
});

export type Agent = z.infer<typeof AgentSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

// AppState schema
export const AppStateSchema = z.object({
  tasks: z.record(TaskIdSchema, TaskSchema),
  views: z.record(ViewIdSchema, ViewSchema),
  agents: z.record(AgentIdSchema, AgentSchema),
  activeTaskId: TaskIdSchema.nullable(),
  activeViewId: ViewIdSchema.nullable(),
});

export type AppState = z.infer<typeof AppStateSchema>;

// Type aliases for IDs - inferred from schemas
export type TaskId = z.infer<typeof TaskIdSchema>;
export type PageId = z.infer<typeof PageIdSchema>;
export type ViewId = z.infer<typeof ViewIdSchema>;
export type AgentId = z.infer<typeof AgentIdSchema>;
