/**
 * Tree Optimization Module
 *
 * This module contains all tree optimization logic extracted from DOMTreeSerializer.
 * It provides standalone functions for optimizing DOM trees by removing empty branches
 * and meaningless elements while preserving important structural and interactive content.
 */

import type { SimplifiedNode } from "@shared/dom";
import { NodeType } from "@shared/dom";
import log from "electron-log/main";

// Create standalone logger for tree optimization
const logger = log.scope("TreeOptimization");

// ==================== HELPER FUNCTIONS ====================

/**
 * Determine if a node should be kept in the optimized tree
 */
export function shouldKeepNode(node: SimplifiedNode): boolean {
	// Keep nodes that are interactive
	if (node.interactiveIndex !== null) {
		return true;
	}

	// Keep nodes that are scrollable
	if (
		node.originalNode.isActuallyScrollable ||
		node.originalNode.isScrollable
	) {
		return true;
	}

	// Keep nodes that have meaningful children
	if (node.children.length > 0) {
		return true;
	}

	// Keep text nodes with meaningful content
	if (
		node.originalNode.nodeType === NodeType.TEXT_NODE &&
		node.originalNode.nodeValue
	) {
		const textValue = node.originalNode.nodeValue.trim();
		return textValue.length > 1;
	}

	// Keep iframes and frames
	if (node.originalNode.tag) {
		const upperTag = node.originalNode.tag.toUpperCase();
		if (upperTag === "IFRAME" || upperTag === "FRAME") {
			return true;
		}
	}

	// Keep shadow hosts
	if (node.isShadowHost) {
		return true;
	}

	// Element meaningfulness check - keep elements with semantic value
	if (hasSemanticMeaning(node)) {
		return true;
	}

	// Default to removing the node if it doesn't meet any criteria
	return false;
}

/**
 * Check if an element has semantic meaning even if empty
 */
export function hasSemanticMeaning(node: SimplifiedNode): boolean {
	const tag = node.originalNode.tag?.toLowerCase();
	if (!tag) return false;

	// Keep elements with important semantic roles
	if (node.originalNode.axNode?.role) {
		const role = String(node.originalNode.axNode.role).toLowerCase();
		const semanticRoles = [
			"button",
			"link",
			"navigation",
			"main",
			"banner",
			"contentinfo",
			"search",
			"complementary",
			"form",
			"region",
			"heading",
			"list",
			"listitem",
			"table",
			"row",
			"cell",
			"grid",
			"gridcell",
			"tab",
			"tabpanel",
			"dialog",
			"alert",
			"status",
			"timer",
			"marquee",
			"application",
			"document",
			"article",
			"section",
			"group",
		];
		if (semanticRoles.includes(role)) {
			return true;
		}
	}

	// Keep elements with meaningful attributes
	if (node.originalNode.attributes) {
		const meaningfulAttrs = [
			"id",
			"data-testid",
			"data-cy",
			"role",
			"aria-label",
			"title",
		];
		for (const attr of meaningfulAttrs) {
			if (node.originalNode.attributes[attr]) {
				return true;
			}
		}
	}

	// Keep important structural elements
	const structuralTags = [
		"header",
		"footer",
		"nav",
		"main",
		"section",
		"article",
		"aside",
		"form",
		"input",
		"button",
		"select",
		"textarea",
		"a",
		"img",
		"video",
		"audio",
		"canvas",
		"svg",
		"iframe",
		"frame",
	];
	if (structuralTags.includes(tag)) {
		return true;
	}

	// Keep form controls
	if (["input", "textarea", "select", "button", "option"].includes(tag)) {
		return true;
	}

	// Keep elements with ARIA attributes
	if (node.originalNode.attributes) {
		for (const [key, value] of Object.entries(node.originalNode.attributes)) {
			if (key.startsWith("aria-") && value) {
				return true;
			}
		}
	}

	return false;
}

// ==================== MAIN TREE OPTIMIZATION FUNCTION ====================

/**
 * Optimize tree by removing empty branches and meaningless elements
 * Based on browser-use's _optimize_tree approach
 *
 * This function recursively processes the DOM tree to remove nodes that don't
 * contain meaningful content while preserving important structural and interactive elements.
 * Operates directly on the node in place, following the same pattern as bounding box and paint order filtering.
 *
 * @param node The SimplifiedNode to optimize
 */
export function applyTreeOptimization(node: SimplifiedNode): void {
	try {
		// First, optimize all children recursively
		const keptChildren: SimplifiedNode[] = [];
		for (const child of node.children) {
			applyTreeOptimization(child);
			if (shouldKeepNode(child)) {
				keptChildren.push(child);
			}
		}

		// Update the node with filtered children in place
		node.children = keptChildren;
		node.hasChildren = keptChildren.length > 0;
	} catch (error) {
		logger.error("Error in applyTreeOptimization:", error);
	}
}
