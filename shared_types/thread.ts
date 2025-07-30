/**
 * AuiThread-related types for the new architecture
 * Each AuiThread (assistant-ui thread) can have multiple browser views
 */

import { z } from "zod";

// Type aliases for clarity
export type ThreadId = string;
export type ViewId = string;

// Schema for AuiView
export const ViewInfoSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  url: z.string(),
  title: z.string(),
  favicon: z.string().optional(),
});

export type ViewInfo = z.infer<typeof ViewInfoSchema>;

// View metadata - combines ViewInfo and display state
export const ViewMetadataSchema = z.object({
  // From ViewInfo
  id: z.string().min(1),
  threadId: z.string().min(1),
  url: z.string(),
  title: z.string(),
  favicon: z.string().optional(),
  // Display state
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  isVisible: z.boolean(),
});

export type ViewMetadata = z.infer<typeof ViewMetadataSchema>;

// Thread-view state for tracking relationships
export const ThreadViewStateSchema = z.object({
  threadId: z.string().min(1),
  viewIds: z.array(z.string()),
  activeViewId: z.string().nullable(),
});

export type ThreadViewState = z.infer<typeof ThreadViewStateSchema>;

// Commands for view operations
export const CreateViewCommandSchema = z.object({
  threadId: z.string().min(1),
  url: z.string().optional(),
  target: z.enum(["tab", "window"]).optional(),
});

export type CreateViewCommand = z.infer<typeof CreateViewCommandSchema>;

export const NavigateViewCommandSchema = z.object({
  viewId: z.string().min(1),
  url: z.string(),
});

export type NavigateViewCommand = z.infer<typeof NavigateViewCommandSchema>;

export const ExecuteViewCommandSchema = z.object({
  viewId: z.string().min(1),
  script: z.string(),
});

export type ExecuteAuiViewCommand = z.infer<typeof ExecuteViewCommandSchema>;

export const SetViewBoundsCommandSchema = z.object({
  viewId: z.string().min(1),
  bounds: ViewMetadataSchema.shape.bounds,
});

export type SetViewBoundsCommand = z.infer<typeof SetViewBoundsCommandSchema>;

export const SetViewVisibilityCommandSchema = z.object({
  viewId: z.string().min(1),
  isVisible: z.boolean(),
});

export type SetViewVisibilityCommand = z.infer<
  typeof SetViewVisibilityCommandSchema
>;

// Events for thread lifecycle
export const ThreadEventSchema = z.discriminatedUnion("type", [
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

export type ThreadEvent = z.infer<typeof ThreadEventSchema>;

// Events for view lifecycle
export const ViewEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("VIEW_CREATED"),
    view: ViewInfoSchema,
  }),
  z.object({
    type: z.literal("VIEW_UPDATED"),
    viewId: z.string().min(1),
    updates: ViewInfoSchema.partial(),
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

export type ViewEvent = z.infer<typeof ViewEventSchema>;

// Result types
export const ViewResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

export type ViewResult = z.infer<typeof ViewResultSchema>;
