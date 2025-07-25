/**
 * IPC command types shared between main and renderer processes
 */

import { z } from "zod";

// Rectangle schema matching Electron's Rectangle interface
export const RectangleSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export type Rectangle = z.infer<typeof RectangleSchema>;

// Other command schemas can go here (non-view related)