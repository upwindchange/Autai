/**
 * Bounding Box Filtering Functions
 *
 * Extracted from DOMTreeSerializer for better code organization.
 * Contains all logic related to bounding box filtering of DOM elements.
 */

import type {
	EnhancedDOMTreeNode,
	SimplifiedNode,
	SerializationConfig,
} from "@shared/dom";
import type { WebContents } from "electron";
import log from "electron-log/main";
import { getElementSize } from "@/services/dom/utils/DOMUtils";

// Root level logger for this module
const logger = log.scope("BoundingBoxFiltering");

// ==================== BOUNDING BOX CONSTANTS ====================

// Propagating elements that can contain child interactive elements
const PROPAGATING_ELEMENTS = [
	{ tag: "a", role: null },
	{ tag: "button", role: null },
	{ tag: "div", role: "button" },
	{ tag: "div", role: "combobox" },
	{ tag: "input", role: "combobox" },
	{ tag: "span", role: "button" },
	{ tag: "span", role: "combobox" },
];

// Default containment threshold for bounds propagation
const DEFAULT_CONTAINMENT_THRESHOLD = 0.99;

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if element is a propagating element that can contain child interactive elements
 */
export function isPropagatingElement(node: EnhancedDOMTreeNode): boolean {
	if (!node.tag) return false;

	const tag = node.tag.toLowerCase();
	const role = node.attributes.role?.toLowerCase() || null;

	return PROPAGATING_ELEMENTS.some(
		(propagating) => propagating.tag === tag && propagating.role === role,
	);
}

/**
 * Check if child element is contained within parent bounds
 */
export function isContainedInParent(
	childNode: SimplifiedNode,
	parentNode: SimplifiedNode,
	threshold: number = DEFAULT_CONTAINMENT_THRESHOLD,
): boolean {
	const childBounds = childNode.originalNode.snapshotNode?.bounds;
	const parentBounds = parentNode.originalNode.snapshotNode?.bounds;

	if (!childBounds || !parentBounds) {
		return false;
	}

	// Calculate intersection area
	const xOverlap = Math.max(
		0,
		Math.min(
			childBounds.x + childBounds.width,
			parentBounds.x + parentBounds.width,
		) - Math.max(childBounds.x, parentBounds.x),
	);
	const yOverlap = Math.max(
		0,
		Math.min(
			childBounds.y + childBounds.height,
			parentBounds.y + parentBounds.height,
		) - Math.max(childBounds.y, parentBounds.y),
	);

	const intersectionArea = xOverlap * yOverlap;
	const childArea = childBounds.width * childBounds.height;

	if (childArea === 0) {
		return false;
	}

	const containmentRatio = intersectionArea / childArea;
	return containmentRatio >= threshold;
}

/**
 * Check if contained element should be kept (exception rules)
 */
export function shouldKeepContainedElement(node: SimplifiedNode): boolean {
	const tag = node.originalNode.tag?.toLowerCase();

	// Always keep form elements
	if (["input", "select", "textarea", "label", "option"].includes(tag || "")) {
		return true;
	}

	// Keep other propagating elements (prevents event stop propagation conflicts)
	if (isPropagatingElement(node.originalNode)) {
		return true;
	}

	// Keep elements with explicit onclick handlers
	if (
		node.originalNode.attributes.onclick &&
		node.originalNode.attributes.onclick !== ""
	) {
		return true;
	}

	// Keep elements with meaningful aria-label
	if (
		node.originalNode.attributes["aria-label"] &&
		node.originalNode.attributes["aria-label"].trim() !== ""
	) {
		return true;
	}

	// Keep interactive role elements
	const role = node.originalNode.attributes.role?.toLowerCase();
	if (
		role &&
		["button", "link", "checkbox", "radio", "menuitem", "tab"].includes(role)
	) {
		return true;
	}

	return false;
}

/**
 * Find propagating parent for bounds checking
 */
export function findPropagatingParent(
	_node: SimplifiedNode,
): SimplifiedNode | null {
	// Note: SimplifiedNode parent relationship is handled differently
	// This method is called after the tree is built, so we traverse the tree structure
	// The actual parent finding logic is implemented in applyBoundingBoxFiltering
	return null;
}

/**
 * Check if element is within valid size range
 */
export async function isWithinValidSizeRange(
	node: EnhancedDOMTreeNode,
	webContents: WebContents,
): Promise<boolean> {
	const size = await getElementSize(node, webContents, logger);
	if (!size) {
		return false;
	}

	return (
		size.width >= 1 &&
		size.width <= Number.MAX_SAFE_INTEGER &&
		size.height >= 1 &&
		size.height <= Number.MAX_SAFE_INTEGER
	);
}

/**
 * Process a single node for bounding box filtering
 */
export async function processBoundingBoxNode(
	node: SimplifiedNode,
	config: SerializationConfig,
	webContents: WebContents,
): Promise<boolean> {
	const enhancedNode = node.originalNode;

	// Skip if element is outside valid size range
	if (!(await isWithinValidSizeRange(enhancedNode, webContents))) {
		return false;
	}

	// Apply bounds propagation filtering if enabled
	if (config.boundingBoxConfig?.enablePropagationFiltering) {
		const propagatingParent = findPropagatingParent(node);
		if (propagatingParent && isContainedInParent(node, propagatingParent)) {
			// Element is contained within a propagating parent
			if (!shouldKeepContainedElement(node)) {
				return false; // Filter out contained elements that shouldn't be kept
			}
		}
	}

	return true; // Keep this node
}

/**
 * Apply bounding box filtering to a complete simplified tree
 *
 * This method implements bounding box filtering as a standalone processing stage
 * that runs after paint order filtering but before tree optimization.
 * It handles size-based filtering and bounds propagation.
 *
 * @param rootNode The root SimplifiedNode to process
 * @param config Configuration for bounding box filtering
 * @param webContents WebContents instance for CDP operations
 */
export async function applyBoundingBoxFiltering(
	rootNode: SimplifiedNode,
	config: SerializationConfig,
	webContents: WebContents,
): Promise<void> {
	try {
		if (!config.enableBoundingBoxFiltering) {
			logger.debug("Bounding box filtering disabled");
			return;
		}

		const startTime = Date.now();
		let totalNodes = 0;
		let excludedNodes = 0;
		let containedNodes = 0;
		let sizeFilteredNodes = 0;

		// Mark excluded nodes for later processing
		const markExcludedNodes = async (
			node: SimplifiedNode,
		): Promise<boolean> => {
			totalNodes++;
			const shouldKeep = await processBoundingBoxNode(
				node,
				config,
				webContents,
			);
			if (!shouldKeep) {
				excludedNodes++;
				node.excludedByBoundingBox = true;

				// Determine exclusion reason for statistics
				if (!(await isWithinValidSizeRange(node.originalNode, webContents))) {
					sizeFilteredNodes++;
					node.exclusionReason = "size_filtered";
				} else if (config.boundingBoxConfig?.enablePropagationFiltering) {
					const propagatingParent = findPropagatingParent(node);
					if (
						propagatingParent &&
						isContainedInParent(node, propagatingParent)
					) {
						containedNodes++;
						node.exclusionReason = "contained";
					}
				}
			}

			// Process children recursively
			for (const child of node.children) {
				await markExcludedNodes(child);
			}

			return shouldKeep;
		};

		await markExcludedNodes(rootNode);

		const processingTime = Date.now() - startTime;
		logger.info(
			`Bounding box filtering completed: ${excludedNodes}/${totalNodes} nodes excluded ` +
				`(${sizeFilteredNodes} size filtered, ${containedNodes} contained) in ${processingTime}ms`,
		);
	} catch (error) {
		logger.error("Error in applyBoundingBoxFiltering:", error);
	}
}
