/**
 * AuiThread-related types for the new architecture
 * Each AuiThread (assistant-ui thread) can have multiple browser views
 */

import { z } from "zod";

// Type aliases for clarity
export type AuiThreadId = string;
export type AuiViewId = string;

// Schema for AuiView
export const AuiViewSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  url: z.string(),
  title: z.string(),
  favicon: z.string().optional(),
});

export type AuiView = z.infer<typeof AuiViewSchema>;

// View metadata for managing display state
export const AuiViewMetadataSchema = z.object({
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  isVisible: z.boolean(),
});

export type AuiViewMetadata = z.infer<typeof AuiViewMetadataSchema>;

// Thread-view state for tracking relationships
export const AuiThreadViewStateSchema = z.object({
  threadId: z.string().min(1),
  viewIds: z.array(z.string()),
  activeViewId: z.string().nullable(),
});

export type AuiThreadViewState = z.infer<typeof AuiThreadViewStateSchema>;

// Commands for view operations
export const CreateAuiViewCommandSchema = z.object({
  threadId: z.string().min(1),
  url: z.string().optional(),
  target: z.enum(["tab", "window"]).optional(),
});

export type CreateAuiViewCommand = z.infer<typeof CreateAuiViewCommandSchema>;

export const NavigateAuiViewCommandSchema = z.object({
  viewId: z.string().min(1),
  url: z.string(),
});

export type NavigateAuiViewCommand = z.infer<typeof NavigateAuiViewCommandSchema>;

export const ExecuteAuiViewCommandSchema = z.object({
  viewId: z.string().min(1),
  script: z.string(),
});

export type ExecuteAuiViewCommand = z.infer<typeof ExecuteAuiViewCommandSchema>;

export const SetAuiViewBoundsCommandSchema = z.object({
  viewId: z.string().min(1),
  bounds: AuiViewMetadataSchema.shape.bounds,
});

export type SetAuiViewBoundsCommand = z.infer<typeof SetAuiViewBoundsCommandSchema>;

export const SetAuiViewVisibilityCommandSchema = z.object({
  viewId: z.string().min(1),
  isVisible: z.boolean(),
});

export type SetAuiViewVisibilityCommand = z.infer<typeof SetAuiViewVisibilityCommandSchema>;

// Events for thread lifecycle
export const AuiThreadEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("THREAD_CREATED"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("THREAD_SWITCHED"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("THREAD_DELETED"),
    threadId: z.string().min(1),
  }),
]);

export type AuiThreadEvent = z.infer<typeof AuiThreadEventSchema>;

// Events for view lifecycle
export const AuiViewEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("VIEW_CREATED"),
    view: AuiViewSchema,
  }),
  z.object({
    type: z.literal("VIEW_UPDATED"),
    viewId: z.string().min(1),
    updates: AuiViewSchema.partial(),
  }),
  z.object({
    type: z.literal("VIEW_CLOSED"),
    viewId: z.string().min(1),
  }),
  z.object({
    type: z.literal("VIEW_ACTIVATED"),
    viewId: z.string().min(1),
  }),
]);

export type AuiViewEvent = z.infer<typeof AuiViewEventSchema>;

// Browser action types for AI tools
export const BrowserActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("navigate"),
    url: z.string(),
  }),
  z.object({
    type: z.literal("screenshot"),
  }),
  z.object({
    type: z.literal("extractText"),
    selector: z.string().optional(),
  }),
  z.object({
    type: z.literal("click"),
    selector: z.string(),
  }),
  z.object({
    type: z.literal("type"),
    selector: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("waitFor"),
    selector: z.string(),
    timeout: z.number().optional(),
  }),
]);

export type BrowserAction = z.infer<typeof BrowserActionSchema>;

// Result types
export const AuiViewResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

export type AuiViewResult = z.infer<typeof AuiViewResultSchema>;