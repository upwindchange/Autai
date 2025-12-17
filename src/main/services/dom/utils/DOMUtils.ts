/**
 * DOM utilities for layout and visibility calculations
 */

import type { EnhancedSnapshotNode, EnhancedDOMTreeNode } from "@shared/dom";
import type { Protocol as CDP } from "devtools-protocol";
import type { WebContents } from "electron";
import type { LogFunctions } from "electron-log/src";

/**
 * Build snapshot lookup using official DOMSnapshot structure
 */
export function buildSnapshotLookup(
	snapshot: CDP.DOMSnapshot.GetSnapshotResponse,
	devicePixelRatio: number = 1.0,
): Record<number, EnhancedSnapshotNode> {
	const lookup: Record<number, EnhancedSnapshotNode> = {};

	if (
		!snapshot.domNodes ||
		!snapshot.layoutTreeNodes ||
		!snapshot.computedStyles
	) {
		return lookup;
	}

	const computedStyleMap = new Map<number, CDP.DOMSnapshot.ComputedStyle>();
	snapshot.computedStyles.forEach((style, index) => {
		computedStyleMap.set(index, style);
	});
	for (const layoutNode of snapshot.layoutTreeNodes) {
		const domNode = snapshot.domNodes[layoutNode.domNodeIndex];
		if (!domNode) continue;

		const backendNodeId = domNode.backendNodeId;

		let bounds: CDP.DOM.Rect | null = null;
		let computedStyles: Record<string, string> | null = null;
		let cursorStyle: string | undefined;
		const isClickable = false;

		if (layoutNode.boundingBox) {
			bounds = {
				x: layoutNode.boundingBox.x / devicePixelRatio,
				y: layoutNode.boundingBox.y / devicePixelRatio,
				width: layoutNode.boundingBox.width / devicePixelRatio,
				height: layoutNode.boundingBox.height / devicePixelRatio,
			};
		}
		if (layoutNode.styleIndex !== undefined) {
			const style = computedStyleMap.get(layoutNode.styleIndex);
			if (style?.properties) {
				computedStyles = {};
				for (const prop of style.properties) {
					computedStyles[prop.name] = prop.value;
				}
			}
		}

		lookup[backendNodeId] = {
			isClickable,
			cursorStyle,
			bounds,
			computedStyles,
			clientRects: null,
			scrollRects: null,
			paintOrder: undefined,
			stackingContexts: undefined,
		};
	}

	return lookup;
}

/**
 * Check if element is visible
 */
export function isElementVisible(
	computedStyles: Record<string, string> | null,
): boolean {
	if (!computedStyles) return true;

	const display = computedStyles.display?.toLowerCase();
	const visibility = computedStyles.visibility?.toLowerCase();
	const opacity = parseFloat(computedStyles.opacity || "1");

	return display !== "none" && visibility !== "hidden" && opacity > 0;
}

/**
 * Check if element is clickable
 */
export function isElementClickable(cursorStyle?: string): boolean {
	return cursorStyle === "pointer";
}

/**
 * Extract scroll info (simplified)
 */
export function extractScrollInfo(
	scrollRects: CDP.DOM.Rect | null,
	clientRects: CDP.DOM.Rect | null,
): {
	scrollTop: number;
	scrollLeft: number;
	scrollableHeight: number;
	scrollableWidth: number;
	visibleHeight: number;
	visibleWidth: number;
} | null {
	if (!scrollRects || !clientRects) return null;

	return {
		scrollTop: scrollRects.y,
		scrollLeft: scrollRects.x,
		scrollableHeight: scrollRects.height,
		scrollableWidth: scrollRects.width,
		visibleHeight: clientRects.height,
		visibleWidth: clientRects.width,
	};
}

/**
 * Check if element is scrollable
 */
export function isElementScrollable(
	scrollRects: CDP.DOM.Rect | null,
	clientRects: CDP.DOM.Rect | null,
	computedStyles: Record<string, string> | null,
): boolean {
	if (!scrollRects || !clientRects) return false;

	const hasScroll =
		scrollRects.height > clientRects.height + 1 ||
		scrollRects.width > clientRects.width + 1;

	if (!hasScroll) return false;

	if (computedStyles) {
		const overflow = computedStyles.overflow?.toLowerCase() || "visible";
		return ["auto", "scroll"].includes(overflow);
	}

	return true;
}

/**
 * Calculate absolute position
 */
export function calculateAbsolutePosition(
	node: { snapshotNode?: { bounds?: CDP.DOM.Rect | null } },
	frameOffset: CDP.DOM.Rect = { x: 0, y: 0, width: 0, height: 0 },
): CDP.DOM.Rect | null {
	if (!node.snapshotNode?.bounds) return null;

	const bounds = node.snapshotNode.bounds;
	return {
		x: bounds.x + frameOffset.x,
		y: bounds.y + frameOffset.y,
		width: bounds.width,
		height: bounds.height,
	};
}

/**
 * Calculate scroll percentage
 */
export function calculateScrollPercentage(
	_elementBounds: CDP.DOM.Rect,
	scrollInfo: {
		scrollTop: number;
		scrollLeft: number;
		scrollableHeight: number;
		scrollableWidth: number;
		visibleHeight: number;
		visibleWidth: number;
	},
): { vertical: number; horizontal: number } {
	let vertical = 0;
	let horizontal = 0;

	if (scrollInfo.scrollableHeight > scrollInfo.visibleHeight) {
		const maxScroll = scrollInfo.scrollableHeight - scrollInfo.visibleHeight;
		vertical = maxScroll > 0 ? (scrollInfo.scrollTop / maxScroll) * 100 : 0;
	}

	if (scrollInfo.scrollableWidth > scrollInfo.visibleWidth) {
		const maxScroll = scrollInfo.scrollableWidth - scrollInfo.visibleWidth;
		horizontal = maxScroll > 0 ? (scrollInfo.scrollLeft / maxScroll) * 100 : 0;
	}

	return {
		vertical: Math.round(vertical * 10) / 10,
		horizontal: Math.round(horizontal * 10) / 10,
	};
}

// CDP Utility Functions

/**
 * Send CDP command with timeout and error handling
 */
export async function sendCDPCommand<T = unknown>(
	webContents: WebContents,
	method: string,
	params?: unknown,
	logger?: LogFunctions,
): Promise<T> {
	try {
		const result = await Promise.race([
			webContents.debugger.sendCommand(method, params),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error(`Command ${method} timed out after 10s`)),
					10000,
				),
			),
		]);

		return result as T;
	} catch (error) {
		logger?.error(`Command ${method} failed:`, error);
		throw error;
	}
}

/**
 * Attach debugger to WebContents
 */
export async function attachDebugger(
	webContents: WebContents,
	logger?: LogFunctions,
): Promise<void> {
	try {
		webContents.debugger.attach("1.3");
		logger?.info("Debugger attached");
	} catch (error) {
		logger?.error(`Failed to attach debugger: ${error}`);
		throw error;
	}
}

/**
 * Detach debugger from WebContents
 */
export async function detachDebugger(
	webContents: WebContents,
	logger?: LogFunctions,
): Promise<void> {
	try {
		webContents.debugger.detach();
		logger?.info("Debugger detached");
	} catch (error) {
		logger?.error(`Failed to detach debugger: ${error}`);
		throw error;
	}
}

/**
 * Check if debugger is attached
 */
export function isDebuggerAttached(webContents: WebContents): boolean {
	return webContents.debugger.isAttached();
}

// Element Size Utilities

/**
 * Get the current device pixel ratio
 */
export async function getDevicePixelRatio(
	webContents: WebContents,
	logger?: LogFunctions,
): Promise<number> {
	try {
		const result = (await sendCDPCommand(
			webContents,
			"Runtime.evaluate",
			{
				expression: "window.devicePixelRatio || 1",
			},
			logger,
		)) as { result: { value: number } };

		const ratio = result.result.value || 1;
		return ratio;
	} catch (error) {
		logger?.error("Failed to get device pixel ratio:", error);
		return 1; // Default fallback
	}
}

/**
 * Convert device pixels to CSS pixels for accurate sizing
 */
export async function deviceToCSSPixels(
	devicePixels: number,
	webContents: WebContents,
	logger?: LogFunctions,
): Promise<number> {
	return devicePixels / (await getDevicePixelRatio(webContents, logger));
}

/**
 * Get element size in CSS pixels
 */
export async function getElementSize(
	node: EnhancedDOMTreeNode,
	webContents: WebContents,
	logger?: LogFunctions,
): Promise<{ width: number; height: number } | null> {
	if (!node.snapshotNode?.bounds) {
		return null;
	}

	const { width, height } = node.snapshotNode.bounds;
	return {
		width: await deviceToCSSPixels(width, webContents, logger),
		height: await deviceToCSSPixels(height, webContents, logger),
	};
}
