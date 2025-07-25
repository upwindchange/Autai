/**
 * IPC command types shared between main and renderer processes
 */

import { z } from "zod";
import { ViewIdSchema } from "./core";

// Rectangle schema matching Electron's Rectangle interface
export const RectangleSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export type Rectangle = z.infer<typeof RectangleSchema>;

// Command schemas

export const SetViewBoundsCommandSchema = z.object({
  viewId: ViewIdSchema,
  bounds: RectangleSchema,
});

export const SetViewVisibilityCommandSchema = z.object({
  viewId: ViewIdSchema,
  isHidden: z.boolean(),
  bounds: RectangleSchema.optional(), // Optional bounds update when showing
});

export const SetActiveViewCommandSchema = z.object({
  viewId: ViewIdSchema.nullable(),
  bounds: RectangleSchema.optional(), // Optional bounds when activating
});

// Export derived types
export type SetViewBoundsCommand = z.infer<typeof SetViewBoundsCommandSchema>;
export type SetViewVisibilityCommand = z.infer<
  typeof SetViewVisibilityCommandSchema
>;
export type SetActiveViewCommand = z.infer<typeof SetActiveViewCommandSchema>;
