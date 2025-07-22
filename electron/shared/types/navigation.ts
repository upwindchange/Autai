/**
 * Navigation-related types shared between main and renderer processes
 */

import { z } from 'zod';
import { TaskIdSchema, PageIdSchema } from './core';

export const NavigateCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  url: z.string().min(1),
});

export type NavigateCommand = z.infer<typeof NavigateCommandSchema>;

export const NavigationResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  url: z.string().url().optional(),
});

export type NavigationResult = z.infer<typeof NavigationResultSchema>;