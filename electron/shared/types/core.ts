/**
 * Core data types shared between main and renderer processes
 */

import { z } from "zod";

// Define Page schema as the source of truth
export const PageSchema = z.object({
  id: z.string(),
  url: z.string(),
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

export interface Task {
  id: string;
  title: string;
  pages: Map<string, Page>; // pageId -> Page
  activePageId: string | null;
}

export interface View {
  id: string;
  taskId: string;
  pageId: string;
}

export interface Agent {
  id: string;
  taskId: string;
  processId: number;
  status: "idle" | "processing" | "error" | "terminated";
  createdAt: number;
}

export interface AppState {
  tasks: Record<string, Task>;
  views: Record<string, View>;
  agents: Record<string, Agent>;
  activeTaskId: string | null;
  activeViewId: string | null;
}
