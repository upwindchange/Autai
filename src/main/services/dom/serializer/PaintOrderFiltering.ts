/**
 * Paint Order Filtering Module
 *
 * This module contains all paint order filtering logic extracted from DOMTreeSerializer.
 * It provides standalone functions for detecting and filtering occluded DOM elements
 * based on their paint order and geometric relationships.
 */

import type {
	EnhancedDOMTreeNode,
	SimplifiedNode,
	SerializationConfig,
} from "@shared/dom";
import log from "electron-log/main";

// ==================== PAINT ORDER INFRASTRUCTURE ====================

// Create standalone logger for paint order filtering
const logger = log.scope("PaintOrderFiltering");

/**
 * Rectangle interface for paint order calculations
 */
export interface PaintOrderRect {
	readonly x1: number;
	readonly y1: number;
	readonly x2: number;
	readonly y2: number;
}

// Paint order filtering constants
const OPACITY_THRESHOLD = 0.8; // Elements with opacity below this are excluded from occlusion calculation
const TRANSPARENT_BACKGROUND = "rgba(0, 0, 0, 0)"; // Transparent background color to check for

// ==================== PAINT ORDER HELPER FUNCTIONS ====================

/**
 * Create a paint order rectangle
 */
export function createPaintOrderRect(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
): PaintOrderRect {
	if (!(x1 <= x2 && y1 <= y2)) {
		throw new Error("Invalid rectangle coordinates");
	}
	return { x1, y1, x2, y2 };
}

/**
 * Check if rectangle a intersects with rectangle b
 */
export function rectIntersects(a: PaintOrderRect, b: PaintOrderRect): boolean {
	return !(a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1);
}

/**
 * Check if rectangle a completely contains rectangle b
 */
export function rectContains(a: PaintOrderRect, b: PaintOrderRect): boolean {
	return a.x1 <= b.x1 && a.y1 <= b.y1 && a.x2 >= b.x2 && a.y2 >= b.y2;
}

/**
 * Split rectangle a by rectangle b, returning a \ b
 * Returns up to 4 rectangles
 */
export function splitDiff(
	a: PaintOrderRect,
	b: PaintOrderRect,
): PaintOrderRect[] {
	const parts: PaintOrderRect[] = [];

	// Bottom slice
	if (a.y1 < b.y1) {
		parts.push({ x1: a.x1, y1: a.y1, x2: a.x2, y2: b.y1 });
	}

	// Top slice
	if (b.y2 < a.y2) {
		parts.push({ x1: a.x1, y1: b.y2, x2: a.x2, y2: a.y2 });
	}

	// Middle (vertical) strip: y overlap is [max(a.y1,b.y1), min(a.y2,b.y2)]
	const yLo = Math.max(a.y1, b.y1);
	const yHi = Math.min(a.y2, b.y2);

	// Left slice
	if (a.x1 < b.x1) {
		parts.push({ x1: a.x1, y1: yLo, x2: b.x1, y2: yHi });
	}

	// Right slice
	if (b.x2 < a.x2) {
		parts.push({ x1: b.x2, y1: yLo, x2: a.x2, y2: yHi });
	}

	return parts;
}

/**
 * Check if rectangle r is fully covered by the current paint order union
 */
export function paintOrderContains(
	r: PaintOrderRect,
	paintOrderRects: PaintOrderRect[],
): boolean {
	if (paintOrderRects.length === 0) {
		return false;
	}

	let stack = [r];
	for (const s of paintOrderRects) {
		const newStack: PaintOrderRect[] = [];
		for (const piece of stack) {
			if (rectContains(s, piece)) {
				// piece completely gone
				continue;
			}
			if (rectIntersects(piece, s)) {
				newStack.push(...splitDiff(piece, s));
			} else {
				newStack.push(piece);
			}
		}
		if (newStack.length === 0) {
			// everything eaten – covered
			return true;
		}
		stack = newStack;
	}
	return false; // something survived
}

/**
 * Insert rectangle r into paint order union unless it is already covered
 * Returns true if the union grew
 */
export function paintOrderAdd(
	r: PaintOrderRect,
	paintOrderRects: PaintOrderRect[],
): boolean {
	if (paintOrderContains(r, paintOrderRects)) {
		return false;
	}

	let pending = [r];
	let i = 0;
	while (i < paintOrderRects.length) {
		const s = paintOrderRects[i];
		const newPending: PaintOrderRect[] = [];
		let changed = false;

		for (const piece of pending) {
			if (rectIntersects(piece, s)) {
				newPending.push(...splitDiff(piece, s));
				changed = true;
			} else {
				newPending.push(piece);
			}
		}

		pending = newPending;
		if (changed) {
			// s unchanged; proceed with next existing rectangle
			i += 1;
		} else {
			i += 1;
		}
	}

	// Any left-over pieces are new, non-overlapping areas
	paintOrderRects.push(...pending);
	return true;
}

/**
 * Check if element should be excluded from occlusion calculation due to transparency
 */
export function shouldExcludeFromOcclusion(node: EnhancedDOMTreeNode): boolean {
	if (!node.snapshotNode?.computedStyles) {
		return false;
	}

	// Check opacity threshold
	const opacity = parseFloat(node.snapshotNode.computedStyles.opacity || "1");
	if (opacity < OPACITY_THRESHOLD) {
		return true;
	}

	// Check for transparent background
	const backgroundColor = node.snapshotNode.computedStyles["background-color"];
	if (backgroundColor === TRANSPARENT_BACKGROUND) {
		return true;
	}

	return false;
}

// ==================== MAIN PAINT ORDER FILTERING FUNCTION ====================

/**
 * Apply paint order filtering to a complete simplified tree
 *
 * This method implements the proper paint order filtering algorithm:
 * 1. Collect all nodes with paint order information from the complete tree
 * 2. Group nodes by paint order value
 * 3. Process elements in descending paint order (highest to lowest)
 * 4. Mark occluded elements so they can be filtered out during serialization
 *
 * @param rootNode The root SimplifiedNode to process
 * @param config Serialization configuration
 */
export async function applyPaintOrderFiltering(
	rootNode: SimplifiedNode,
	config: SerializationConfig,
): Promise<void> {
	try {
		if (!config.enablePaintOrderFiltering) {
			logger.debug("Paint order filtering disabled");
			return;
		}

		// Phase 1: Collect all nodes with paint order information
		const nodesWithPaintOrder: SimplifiedNode[] = [];

		const collectNodesWithPaintOrder = (node: SimplifiedNode) => {
			if (
				node.originalNode?.snapshotNode?.paintOrder !== null &&
				node.originalNode?.snapshotNode?.paintOrder !== undefined &&
				node.originalNode?.snapshotNode?.bounds
			) {
				nodesWithPaintOrder.push(node);
			}

			// Recursively process children
			if (node.children) {
				for (const child of node.children) {
					collectNodesWithPaintOrder(child);
				}
			}
		};

		collectNodesWithPaintOrder(rootNode);

		if (nodesWithPaintOrder.length === 0) {
			logger.debug(
				"No nodes with paint order found, skipping paint order filtering",
			);
			return;
		}

		// Phase 2: Group nodes by paint order
		const groupedByPaintOrder = new Map<number, SimplifiedNode[]>();

		for (const node of nodesWithPaintOrder) {
			const paintOrder = node.originalNode.snapshotNode!.paintOrder;
			if (paintOrder !== undefined && !groupedByPaintOrder.has(paintOrder)) {
				groupedByPaintOrder.set(paintOrder, []);
			}
			if (paintOrder !== undefined) {
				groupedByPaintOrder.get(paintOrder)!.push(node);
			}
		}

		// Phase 3: Process elements in descending paint order (highest to lowest)
		// Reset paint order state for fresh processing
		const paintOrderRects: PaintOrderRect[] = [];
		const paintOrderProcessed = new Set<number>();

		const sortedPaintOrders = Array.from(groupedByPaintOrder.keys()).sort(
			(a, b) => b - a,
		);

		for (const paintOrder of sortedPaintOrders) {
			const nodes = groupedByPaintOrder.get(paintOrder)!;

			for (const node of nodes) {
				const bounds = node.originalNode.snapshotNode!.bounds;
				if (!bounds) continue;

				const elementRect = createPaintOrderRect(
					bounds.x,
					bounds.y,
					bounds.x + bounds.width,
					bounds.y + bounds.height,
				);

				// Check if this element is occluded by higher paint order elements
				if (paintOrderContains(elementRect, paintOrderRects)) {
					// Mark this node as ignored by paint order
					node.ignoredByPaintOrder = true;
					logger.debug(
						`Node ${node.originalNode.nodeId} occluded by higher paint order elements`,
					);
				} else {
					// Don't add to the union if element should be excluded from occlusion calculation
					if (!shouldExcludeFromOcclusion(node.originalNode)) {
						paintOrderAdd(elementRect, paintOrderRects);
					}
				}
			}

			// Mark this paint order as processed
			paintOrderProcessed.add(paintOrder);
		}

		logger.info(
			`Paint order filtering completed: processed ${nodesWithPaintOrder.length} nodes across ${sortedPaintOrders.length} paint order levels`,
		);
	} catch (error) {
		logger.error("Error in applyPaintOrderFiltering:", error);
	}
}
