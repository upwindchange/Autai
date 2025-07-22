/**
 * IPC command types shared between main and renderer processes
 */

import { z } from 'zod';
import { TaskIdSchema, PageIdSchema, ViewIdSchema } from './core';

// Rectangle schema matching Electron's Rectangle interface
const RectangleSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

// Command schemas
export const CreateTaskCommandSchema = z.object({
  title: z.string().optional(),
  initialUrl: z.string().optional(),
});

export const AddPageCommandSchema = z.object({
  taskId: TaskIdSchema,
  url: z.string().min(1),
});

export const SelectPageCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
});

export const DeleteTaskCommandSchema = z.object({
  taskId: TaskIdSchema,
});

export const DeletePageCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
});

export const SetViewBoundsCommandSchema = z.object({
  viewId: ViewIdSchema,
  bounds: RectangleSchema,
});

export const SetViewVisibilityCommandSchema = z.object({
  viewId: ViewIdSchema,
  isHidden: z.boolean(),
});

export const NavigationControlCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  action: z.enum(['back', 'forward', 'reload', 'stop']),
});

// Browser Action Commands
export const NavigateToCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  url: z.string().min(1),
});

export const BrowserNavigationCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
});

export const ClickElementCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  elementId: z.number().int().nonnegative(),
});

export const TypeTextCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  elementId: z.number().int().nonnegative(),
  text: z.string(),
});

export const PressKeyCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  key: z.string().min(1),
});

export const GetPageElementsCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  options: z.object({
    viewportOnly: z.boolean().optional(),
  }).optional(),
});

export const ExtractTextCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  elementId: z.number().int().nonnegative().optional(),
});

export const CaptureScreenshotCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  options: z.object({
    rect: RectangleSchema.optional(),
  }).optional(),
});

export const ScrollPageCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  direction: z.enum(['up', 'down']),
  amount: z.number().positive().optional(),
});

export const ScrollToElementCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  elementId: z.number().int().nonnegative(),
});

export const HoverCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  elementId: z.number().int().nonnegative(),
});

export const WaitForSelectorCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  selector: z.string().min(1),
  timeout: z.number().positive().optional(),
});

export const SelectOptionCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  elementId: z.number().int().nonnegative(),
  value: z.string(),
});

export const SetCheckboxCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  elementId: z.number().int().nonnegative(),
  checked: z.boolean(),
});

export const ExecuteScriptCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  script: z.string().min(1),
});

export const PageInfoCommandSchema = z.object({
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
});

// Export derived types
export type CreateTaskCommand = z.infer<typeof CreateTaskCommandSchema>;
export type AddPageCommand = z.infer<typeof AddPageCommandSchema>;
export type SelectPageCommand = z.infer<typeof SelectPageCommandSchema>;
export type DeleteTaskCommand = z.infer<typeof DeleteTaskCommandSchema>;
export type DeletePageCommand = z.infer<typeof DeletePageCommandSchema>;
export type SetViewBoundsCommand = z.infer<typeof SetViewBoundsCommandSchema>;
export type SetViewVisibilityCommand = z.infer<typeof SetViewVisibilityCommandSchema>;
export type NavigationControlCommand = z.infer<typeof NavigationControlCommandSchema>;
export type NavigateToCommand = z.infer<typeof NavigateToCommandSchema>;
export type BrowserNavigationCommand = z.infer<typeof BrowserNavigationCommandSchema>;
export type ClickElementCommand = z.infer<typeof ClickElementCommandSchema>;
export type TypeTextCommand = z.infer<typeof TypeTextCommandSchema>;
export type PressKeyCommand = z.infer<typeof PressKeyCommandSchema>;
export type GetPageElementsCommand = z.infer<typeof GetPageElementsCommandSchema>;
export type ExtractTextCommand = z.infer<typeof ExtractTextCommandSchema>;
export type CaptureScreenshotCommand = z.infer<typeof CaptureScreenshotCommandSchema>;
export type ScrollPageCommand = z.infer<typeof ScrollPageCommandSchema>;
export type ScrollToElementCommand = z.infer<typeof ScrollToElementCommandSchema>;
export type HoverCommand = z.infer<typeof HoverCommandSchema>;
export type WaitForSelectorCommand = z.infer<typeof WaitForSelectorCommandSchema>;
export type SelectOptionCommand = z.infer<typeof SelectOptionCommandSchema>;
export type SetCheckboxCommand = z.infer<typeof SetCheckboxCommandSchema>;
export type ExecuteScriptCommand = z.infer<typeof ExecuteScriptCommandSchema>;
export type PageInfoCommand = z.infer<typeof PageInfoCommandSchema>;