/**
 * DOM-related type definitions for browser automation and element interaction
 */

import { z } from 'zod';

// Viewport Info schema
export const ViewportInfoSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

export type ViewportInfo = z.infer<typeof ViewportInfoSchema>;

// Forward declarations for recursive types
interface DOMElementNodeType extends z.infer<typeof DOMBaseNodeSchema> {
  type: 'ELEMENT_NODE';
  tagName: string;
  xpath: string;
  attributes: Record<string, string>;
  children: (DOMElementNodeType | DOMTextNodeType)[];
  isInteractive: boolean;
  isTopElement: boolean;
  isInViewport: boolean;
  highlightIndex?: number | null;
  shadowRoot: boolean;
  viewportInfo?: ViewportInfo | null;
}

interface DOMTextNodeType extends z.infer<typeof DOMBaseNodeSchema> {
  type: 'TEXT_NODE';
  text: string;
}

// Base node schema (without parent to avoid circular reference)
const DOMBaseNodeSchema = z.object({
  isVisible: z.boolean(),
});

// Text node schema
export const DOMTextNodeSchema: z.ZodType<DOMTextNodeType> = DOMBaseNodeSchema.extend({
  type: z.literal('TEXT_NODE'),
  text: z.string(),
  parent: z.custom<DOMElementNodeType | null>(),
});

// Element node schema (using lazy for recursive children)
export const DOMElementNodeSchema: z.ZodType<DOMElementNodeType> = DOMBaseNodeSchema.extend({
  type: z.literal('ELEMENT_NODE'),
  tagName: z.string(),
  xpath: z.string(),
  attributes: z.record(z.string(), z.string()),
  children: z.array(z.lazy(() => DOMNodeSchema)),
  isInteractive: z.boolean(),
  isTopElement: z.boolean(),
  isInViewport: z.boolean(),
  highlightIndex: z.number().int().positive().nullable().optional(),
  shadowRoot: z.boolean(),
  viewportInfo: ViewportInfoSchema.nullable().optional(),
  parent: z.custom<DOMElementNodeType | null>(),
});

// Union type for DOM nodes
export const DOMNodeSchema = z.union([DOMElementNodeSchema, DOMTextNodeSchema]);

export type DOMNode = z.infer<typeof DOMNodeSchema>;
export type DOMElementNode = DOMElementNodeType;
export type DOMTextNode = DOMTextNodeType;

// Selector Map schema
export const SelectorMapSchema = z.record(
  z.coerce.number().int().positive(),
  DOMElementNodeSchema
);

export type SelectorMap = z.infer<typeof SelectorMapSchema>;

// DOM State schema
export const DOMStateSchema = z.object({
  elementTree: DOMElementNodeSchema,
  selectorMap: SelectorMapSchema,
});

export type DOMState = z.infer<typeof DOMStateSchema>;

// Build DOM Tree Args schema
export const BuildDomTreeArgsSchema = z.object({
  doHighlightElements: z.boolean(),
  focusHighlightIndex: z.number().int(),
  viewportExpansion: z.number().nonnegative(),
  debugMode: z.boolean(),
});

export type BuildDomTreeArgs = z.infer<typeof BuildDomTreeArgsSchema>;

/**
 * Raw node data returned from JavaScript DOM analysis
 */
export const JSNodeDataSchema = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
  tagName: z.string().optional(),
  xpath: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  isVisible: z.boolean().optional(),
  isInteractive: z.boolean().optional(),
  isTopElement: z.boolean().optional(),
  isInViewport: z.boolean().optional(),
  highlightIndex: z.number().int().positive().nullable().optional(),
  shadowRoot: z.boolean().optional(),
  children: z.array(z.string()).optional(),
  viewport: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }).optional(),
});

export type JSNodeData = z.infer<typeof JSNodeDataSchema>;

/**
 * Result from JavaScript DOM tree evaluation
 */
export const JSEvalResultSchema = z.object({
  map: z.record(z.string(), JSNodeDataSchema),
  rootId: z.string(),
  perfMetrics: z.object({
    nodeMetrics: z.object({
      totalNodes: z.number().int().nonnegative().optional(),
      processedNodes: z.number().int().nonnegative().optional(),
    }).optional(),
  }).optional(),
});

export type JSEvalResult = z.infer<typeof JSEvalResultSchema>;

/**
 * Performance metrics for DOM analysis
 */
export const DOMPerfMetricsSchema = z.object({
  totalNodes: z.number().int().nonnegative(),
  processedNodes: z.number().int().nonnegative(),
  interactiveNodes: z.number().int().nonnegative(),
  analysisTime: z.number().nonnegative(),
});

export type DOMPerfMetrics = z.infer<typeof DOMPerfMetricsSchema>;