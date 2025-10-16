/**
 * DOM Serializer Module - Advanced DOM serialization components
 *
 * Comprehensive system for DOM serialization with advanced filtering,
 * interactive element detection, and compound component virtualization.
 */

export { InteractiveElementDetector } from './InteractiveElementDetector';
export { PaintOrderAnalyzer } from './PaintOrderAnalyzer';
export { DOMTreeSerializer } from './DOMTreeSerializer';
export { BoundingBoxFilter } from './BoundingBoxFilter';
export { CompoundComponentBuilder } from './CompoundComponentBuilder';

// Re-export types for convenience
export type {
  SerializationConfig,
  SerializationTiming,
  SerializationStats,
  CompoundComponent,
  InteractiveDetectionResult,
  PaintOrderStats,
  BoundingBoxFilterStats
} from '@shared/dom/types';

export type {
  IInteractiveElementDetector,
  IPaintOrderAnalyzer,
  IBoundingBoxFilter,
  IDOMTreeSerializer,
  ICompoundComponentBuilder
} from '@shared/dom/interfaces';