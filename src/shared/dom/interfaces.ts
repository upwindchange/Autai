/**
 * DOM service interfaces for CDP infrastructure
 * Simplified implementation following browser-use patterns with minimal abstraction
 */

import type {
	EnhancedDOMTreeNode,
	SerializedDOMState,
	SimplifiedNode,
	SerializationConfig,
	InteractiveDetectionResult,
	PaintOrderStats,
	BoundingBoxFilterStats,
} from "./types";

export interface IDOMService {
	/**
	 * Get DOM tree with change detection.
	 * This method returns the current DOM tree with change analysis.
	 * @param keepPreviousState - If true, don't update this.previousState. If false (default), update to new state.
	 */
	buildSimplifiedDOMTree(keepPreviousState?: boolean);

	/**
	 * Initialize the DOM service
	 */
	initialize(): Promise<void>;

	/**
	 * Get service status information
	 */
	getStatus(): {
		isInitialized: boolean;
		isAttached: boolean;
		webContentsId: number;
	};

	/**
	 * Cleanup resources
	 */
	destroy(): Promise<void>;
}

/**
 * Interactive element detector interface
 */
export interface IInteractiveElementDetector {
	/**
	 * Check if element is interactive with scoring
	 */
	isInteractive(node: EnhancedDOMTreeNode): InteractiveDetectionResult;

	/**
	 * Get detailed debug information
	 */
	getDebugInfo(node: EnhancedDOMTreeNode): {
		tagName: string;
		attributes: Record<string, string>;
		accessibility: {
			role?: string;
			name?: string;
			properties?: Array<{ name: string; value: unknown }>;
		};
		visual: {
			cursor?: string;
			isVisible?: boolean;
			bounds?: { width: number; height: number };
		};
		detection: InteractiveDetectionResult;
	};
}

/**
 * Paint order analyzer interface
 */
export interface IPaintOrderAnalyzer {
	/**
	 * Filter nodes based on paint order and occlusion
	 */
	filterNodes(nodes: SimplifiedNode[]): SimplifiedNode[];

	/**
	 * Get filtering statistics
	 */
	getStats(): PaintOrderStats;
}

/**
 * Bounding box filter interface
 */
export interface IBoundingBoxFilter {
	/**
	 * Apply bounding box filtering to tree
	 */
	filterTree(root: SimplifiedNode): BoundingBoxFilterStats;

	/**
	 * Get filtering statistics
	 */
	getFilteringStats(root: SimplifiedNode): BoundingBoxFilterStats;

	/**
	 * Configure filtering parameters
	 */
	updateConfig(
		config: Partial<{
			containmentThreshold: number;
			enableSizeFiltering: boolean;
			minElementSize: number;
			maxElementSize: number;
		}>,
	): void;
}

/**
 * DOM tree serializer interface
 */
export interface IDOMTreeSerializer {
	/**
	 * Simplify DOM tree - main serialization method
	 */
	simplifyDOMTree(
		rootNode: EnhancedDOMTreeNode,
		previousState?: SerializedDOMState,
		config?: Partial<SerializationConfig>,
	): Promise<SerializedDOMState>;

	/**
	 * Generate LLM representation for a SimplifiedNode
	 */
	flattenSimplifiedDOMTree(node: SimplifiedNode): Promise<string>;
}

/**
 * Compound component builder interface
 */
export interface ICompoundComponentBuilder {
	/**
	 * Build compound components for complex form controls
	 */
	buildCompoundComponents(node: SimplifiedNode): void;

	/**
	 * Check if node can be virtualized
	 */
	canVirtualize(node: EnhancedDOMTreeNode): boolean;

	/**
	 * Get virtual component types
	 */
	getSupportedTypes(): string[];
}

/**
 * Iframe processor interface
 */
export interface IIframeProcessor {
	/**
	 * Process cross-origin iframes
	 */
	processIframes(root: EnhancedDOMTreeNode): Promise<EnhancedDOMTreeNode>;

	/**
	 * Check if iframe should be processed
	 */
	shouldProcessIframe(node: EnhancedDOMTreeNode): boolean;

	/**
	 * Get iframe statistics
	 */
	getIframeStats(): {
		totalIframes: number;
		processedIframes: number;
		skippedIframes: number;
		crossOriginIframes: number;
	};
}

/**
 * Performance optimizer interface
 */
export interface IPerformanceOptimizer {
	/**
	 * Enable caching for serialization components
	 */
	enableCaching(enabled: boolean): void;

	/**
	 * Get performance metrics
	 */
	getMetrics(): {
		cacheHitRate: number;
		averageSerializationTime: number;
		memoryUsage: number;
		optimizationLevel: number;
	};

	/**
	 * Clear all caches
	 */
	clearCache(): void;

	/**
	 * Optimize serialization configuration
	 */
	optimizeConfiguration(targetMetrics: {
		maxSerializationTime: number;
		maxMemoryUsage: number;
		minAccuracy: number;
	}): SerializationConfig;
}
