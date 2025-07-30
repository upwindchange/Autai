import { z } from 'zod';

// Action Result schema
export const ActionResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  extractedContent: z.string().optional(),
  screenshot: z.instanceof(Buffer).optional(),
});

export type ActionResult = z.infer<typeof ActionResultSchema>;

// Element type schema
export const ElementTypeSchema = z.enum([
  "link",
  "button",
  "input",
  "select",
  "textarea",
  "scrollable",
  "frame",
  "details",
  "interactive"
]);

// Rectangle schema
const RectSchema = z.object({
  top: z.number(),
  left: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

// Interactable Element schema
export const InteractableElementSchema = z.object({
  id: z.number().int().positive(), // 1-based index
  type: ElementTypeSchema,
  text: z.string(), // From getLinkText()
  href: z.string().optional(),
  rect: RectSchema,
  reason: z.string().optional(), // Why element is interactive
  xpath: z.string().optional(), // XPath for locating element
  selector: z.string().optional(), // Simple selector reference
});

export type InteractableElement = z.infer<typeof InteractableElementSchema>;

// Screenshot Options schema
export const ScreenshotOptionsSchema = z.object({
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }).optional(),
  fullPage: z.boolean().optional(),
});

export type ScreenshotOptions = z.infer<typeof ScreenshotOptionsSchema>;

// Browser Action Options schema
export const BrowserActionOptionsSchema = z.object({
  timeout: z.number().int().positive().optional(),
  waitForNavigation: z.boolean().optional(),
  screenshot: z.boolean().optional(),
});

export type BrowserActionOptions = z.infer<typeof BrowserActionOptionsSchema>;