/**
 * Direct CDP integration for DOM manipulation and analysis
 */

import type { WebContents } from "electron";
import log from "electron-log/main";
import type { Protocol as CDP } from "devtools-protocol";

import type {
	IDOMService,
	EnhancedDOMTreeNode,
	TargetAllTrees,
	SerializedDOMState,
	EnhancedSnapshotNode,
	BoundsObject,
} from "@shared/dom";
import { DOMTreeSerializer } from "@/services/dom/serializer/DOMTreeSerializer";
import {
	sendCDPCommand,
	attachDebugger,
	detachDebugger,
	isDebuggerAttached,
} from "@/services/dom/utils/DOMUtils";

export class DOMService implements IDOMService {
	private webContents: WebContents;
	private logger = log.scope("DOMService");
	public serializer: DOMTreeSerializer;
	public simplifiedDOMState?: SerializedDOMState;

	constructor(webContents: WebContents) {
		this.webContents = webContents;
		this.serializer = new DOMTreeSerializer(webContents);
		this.logger.info("DOMService initialized - DOM analysis only");
	}

	/**
	 * Initialize the DOM service
	 */
	async initialize(): Promise<void> {
		try {
			await attachDebugger(this.webContents, this.logger);
			this.logger.info("DOMService initialized");
		} catch (error) {
			this.logger.error("Failed to initialize DOMService:", error);
			throw error;
		}
	}

	/**
	 * Cleanup resources
	 */
	async destroy(): Promise<void> {
		try {
			await detachDebugger(this.webContents, this.logger);
			this.simplifiedDOMState = undefined;
			this.logger.info("DOMService destroyed");
		} catch (error) {
			this.logger.error("Error during DOMService destruction:", error);
		}
	}

	/**
	 * Get enhanced DOM tree with integrated CDP data
	 */
	private async getAdvancedDOMTree(): Promise<EnhancedDOMTreeNode> {
		if (!isDebuggerAttached(this.webContents)) {
			throw new Error("Debugger not attached - call initialize() first");
		}

		try {
			this.logger.debug("Getting DOM tree");

			await sendCDPCommand(
				this.webContents,
				"DOM.enable",
				undefined,
				this.logger,
			);
			this.logger.debug("DOM agent enabled successfully");

			const trees = await this.getAllTrees();

			this.logger.debug(
				`CDP Snapshot processed: ${trees.snapshot ? "available" : "missing"}`,
			);

			this.logger.debug("Building enhanced DOM tree from CDP data");
			const enhancedTree = this.buildAdvancedDOMTree(trees);

			const nodeCount = this.countNodes(enhancedTree);
			this.logger.info(`DOM tree built successfully with ${nodeCount} nodes`);
			return enhancedTree;
		} catch (error) {
			this.logger.error(`Failed to get DOM tree: ${error}`);
			throw error;
		}
	}

	/**
	 * Get all CDP tree data for DOM analysis
	 */
	private async getAllTrees(): Promise<TargetAllTrees> {
		try {
			this.logger.debug("Collecting CDP data");

			// Get DOM data in parallel with correct CDP typing
			const [domTree, snapshot, axTree] = await Promise.allSettled([
				sendCDPCommand<CDP.DOM.GetDocumentResponse>(
					this.webContents,
					"DOM.getDocument",
					{
						depth: -1,
						pierce: true,
					},
					this.logger,
				),
				sendCDPCommand<CDP.DOMSnapshot.CaptureSnapshotResponse>(
					this.webContents,
					"DOMSnapshot.captureSnapshot",
					{
						computedStyles: [
							"display",
							"visibility",
							"opacity",
							"cursor",
							"position",
						],
						includePaintOrder: true,
						includeDOMRects: true,
						includeBlendedBackgroundColors: false,
						includeTextColorOpacities: false,
					},
					this.logger,
				),
				sendCDPCommand<CDP.Accessibility.GetFullAXTreeResponse>(
					this.webContents,
					"Accessibility.getFullAXTree",
					undefined,
					this.logger,
				),
			]);

			return {
				snapshot: snapshot.status === "fulfilled" ? snapshot.value : null,
				domTree: domTree.status === "fulfilled" ? domTree.value : null,
				axTree: axTree.status === "fulfilled" ? axTree.value : { nodes: [] },
				devicePixelRatio: 1.0, // Simplified - use basic scaling
				cdpTiming: { cdp_calls_total: 0 },
			};
		} catch (error) {
			this.logger.error(`CDP data collection failed: ${error}`);
			throw error;
		}
	}

	/**
	 * Build enhanced DOM tree from CDP data (simplified DOMTreeBuilder merge)
	 */
	private buildAdvancedDOMTree(trees: TargetAllTrees): EnhancedDOMTreeNode {
		const { snapshot, domTree, axTree } = trees;

		this.logger.debug("Building enhanced DOM tree", {
			hasDomTree: !!domTree,
			hasSnapshot: !!snapshot,
			axTreeNodes: axTree?.nodes?.length || 0,
		});

		// Build lookups
		const axTreeLookup: Record<number, CDP.Accessibility.AXNode> = {};
		for (const axNode of axTree.nodes) {
			if (axNode.backendDOMNodeId) {
				axTreeLookup[axNode.backendDOMNodeId] = axNode;
			}
		}

		const snapshotLookup = this.buildSnapshotLookup(snapshot, 1.0);
		this.logger.debug(
			`DOM Service: snapshotLookup created with ${
				Object.keys(snapshotLookup).length
			} entries`,
		);
		this.logger.debug(
			`DOM Service: snapshot has ${snapshot?.documents?.length || 0} documents`,
		);
		const nodeLookup: Record<number, EnhancedDOMTreeNode> = {};

		// Build enhanced tree
		if (!domTree) {
			throw new Error("DOM tree is null - cannot build enhanced tree");
		}
		return this.buildAdvancedNode(
			domTree.root,
			axTreeLookup,
			snapshotLookup,
			nodeLookup,
			"default",
		);
	}

	/**
	 * Build snapshot lookup using actual DOMSnapshot.captureSnapshot response structure
	 */
	private buildSnapshotLookup(
		snapshot: CDP.DOMSnapshot.CaptureSnapshotResponse | null,
		_devicePixelRatio: number,
	): Record<number, EnhancedSnapshotNode> {
		const lookup: Record<number, EnhancedSnapshotNode> = {};

		if (!snapshot || !snapshot.documents || snapshot.documents.length === 0) {
			return lookup;
		}

		const doc = snapshot.documents[0];
		const { layout, nodes } = doc;

		if (
			!layout ||
			!nodes ||
			!layout.nodeIndex ||
			!layout.bounds ||
			!nodes.backendNodeId
		) {
			return lookup;
		}

		// Build lookup from layout.nodeIndex correlating with nodes.backendNodeId
		for (let i = 0; i < layout.nodeIndex.length; i++) {
			const nodeArrayIndex = layout.nodeIndex[i];

			// Ensure the nodeArrayIndex is valid
			if (nodeArrayIndex >= nodes.backendNodeId.length) {
				this.logger.warn(
					`Skipping layout index ${i}: nodeArrayIndex ${nodeArrayIndex} exceeds nodes.backendNodeId length ${nodes.backendNodeId.length}`,
				);
				continue;
			}

			const backendNodeId = nodes.backendNodeId[nodeArrayIndex];

			// Extract bounds from layout.bounds array
			// From diagnostic logs, the bounds appear to be individual x,y,width,height values
			// Each layout entry should have its own bounds object in the bounds array
			// The bounds array length equals nodeIndex length, so it's 1:1 mapping
			if (i < layout.bounds.length) {
				// Based on diagnostic logs, it seems each entry in bounds array is a complete bounds object
				// Let's handle different possible structures:
				let bounds: CDP.DOM.Rect;

				if (Array.isArray(layout.bounds[i])) {
					// If bounds[i] is an array with 4+ values [x,y,width,height,...]
					const boundsArray = layout.bounds[i];
					if (boundsArray.length >= 4) {
						bounds = {
							x: boundsArray[0],
							y: boundsArray[1],
							width: boundsArray[2],
							height: boundsArray[3],
						};
					} else {
						// Invalid bounds array, skip
						this.logger.warn(
							`Skipping layout index ${i}: bounds array has insufficient length ${boundsArray.length}`,
						);
						continue;
					}
				} else if (
					typeof layout.bounds[i] === "object" &&
					layout.bounds[i] !== null
				) {
					// If bounds[i] is an object with x,y,width,height properties
					const boundsObj = layout.bounds[i] as unknown as BoundsObject;
					bounds = {
						x: boundsObj.x || 0,
						y: boundsObj.y || 0,
						width: boundsObj.width || 0,
						height: boundsObj.height || 0,
					};
				} else {
					// Invalid bounds structure, skip
					this.logger.warn(
						`Skipping layout index ${i}: bounds has invalid type ${typeof layout
							.bounds[i]}`,
					);
					continue;
				}

				// Get isClickable if available
				const isClickable = nodes.isClickable?.[nodeArrayIndex] || false;

				// Store in lookup
				lookup[backendNodeId] = {
					bounds,
					computedStyles: null, // Not available in this structure
					isClickable,
				};
			} else {
				this.logger.warn(
					`Skipping layout index ${i}: bounds index ${i} exceeds bounds.length ${layout.bounds.length}`,
				);
			}
		}

		return lookup;
	}

	/**
	 * Construct enhanced node (simplified)
	 */
	private buildAdvancedNode(
		node: CDP.DOM.Node,
		axTreeLookup: Record<number, CDP.Accessibility.AXNode>,
		snapshotLookup: Record<number, EnhancedSnapshotNode>,
		nodeLookup: Record<number, EnhancedDOMTreeNode>,
		targetId: string,
	): EnhancedDOMTreeNode {
		// Validate node
		if (!node || typeof node.nodeId === "undefined") {
			this.logger.error(
				"Invalid node provided to constructEnhancedNode:",
				node,
			);
			throw new Error("Invalid node: nodeId is undefined");
		}

		// Check if already processed
		if (nodeLookup[node.nodeId]) {
			return nodeLookup[node.nodeId];
		}

		// Parse attributes
		const attributes: Record<string, string> = {};
		if (node.attributes) {
			for (let i = 0; i < node.attributes.length; i += 2) {
				attributes[node.attributes[i]] = node.attributes[i + 1] || "";
			}
		}

		// Get snapshot data
		const snapshotData = snapshotLookup[node.backendNodeId];
		const axNode = axTreeLookup[node.backendNodeId];

		// Create enhanced node
		const enhancedNode: EnhancedDOMTreeNode = {
			nodeId: node.nodeId,
			backendNodeId: node.backendNodeId,
			nodeType: node.nodeType,
			nodeName: node.nodeName,
			localName: node.localName,
			nodeValue: node.nodeValue || "",
			attributes,
			isScrollable: false, // Will be calculated from snapshot data if available
			isVisible: true, // Will be calculated later
			absolutePosition: snapshotData?.bounds || null,
			targetId,
			frameId: null, // DOMNode doesn't have frameId in official types
			sessionId: null,
			shadowRootType: null, // Will be set if this is a shadow root
			shadowRoots: [],
			parentNode: null,
			childrenNodes: [],
			contentDocument: null,
			axNode: axNode || null,
			snapshotNode: snapshotData,
			elementIndex: null,
			_compoundChildren: [],
			uuid: Math.random().toString(36).substring(2, 15),

			// Simplified getters
			get tag() {
				return this.nodeName.toLowerCase();
			},
			get actualChildren() {
				return this.childrenNodes || [];
			},
			get childrenAndShadowRoots() {
				const children = [...(this.childrenNodes || [])];
				if (this.shadowRoots) children.push(...this.shadowRoots);
				return children;
			},
			get parent() {
				return this.parentNode;
			},
			get isActuallyScrollable() {
				return this.isScrollable || false;
			},
			get shouldShowScrollInfo(): boolean {
				return (this.isScrollable || false) && this.tag ?
						["body", "html"].includes(this.tag)
					:	false;
			},
			get scrollInfo() {
				return null;
			},
			get elementHash() {
				return 0;
			},
		};

		// Store in lookup
		nodeLookup[node.nodeId] = enhancedNode;

		// Process children recursively
		if (node.children && Array.isArray(node.children)) {
			enhancedNode.childrenNodes = [];
			for (const child of node.children) {
				// Validate child before processing - child should be a DOM node directly
				if (!child || typeof child.nodeId === "undefined") {
					this.logger.warn("Skipping invalid child node:", child);
					continue;
				}

				const childNode = this.buildAdvancedNode(
					child,
					axTreeLookup,
					snapshotLookup,
					nodeLookup,
					targetId,
				);
				childNode.parentNode = enhancedNode;
				enhancedNode.childrenNodes.push(childNode);
			}
		}

		// Calculate visibility
		if (snapshotData?.computedStyles) {
			const styles = snapshotData.computedStyles;
			enhancedNode.isVisible =
				styles.display !== "none" &&
				styles.visibility !== "hidden" &&
				parseFloat(styles.opacity || "1") > 0;
		} else {
			enhancedNode.isVisible = true;
		}

		return enhancedNode;
	}

	/**
	 * Count total nodes in tree
	 */
	private countNodes(node: EnhancedDOMTreeNode): number {
		let count = 1;
		for (const child of node.childrenNodes || []) {
			count += this.countNodes(child);
		}
		return count;
	}

	/**
	 * Get DOM tree with change detection.
	 * This method returns the current DOM tree with change analysis.
	 * @param keepPreviousState - If true, don't update this.previousState. If false (default), update to new state.
	 */
	async buildSimplifiedDOMTree(keepPreviousState: boolean = false) {
		if (!isDebuggerAttached(this.webContents)) {
			throw new Error("Debugger not attached - call initialize() first");
		}

		try {
			this.logger.debug("Starting change detection", {
				keepPreviousState,
				hasCurrentState: !!this.simplifiedDOMState,
				currentStateSelectorMapSize:
					this.simplifiedDOMState?.selectorMap ?
						Object.keys(this.simplifiedDOMState.selectorMap).length
					:	0,
			});

			const advancedDOMTree = await this.getAdvancedDOMTree();

			// Always use the internal previousState for comparison
			const simplifiedDOMState = await this.serializer.simplifyDOMTree(
				advancedDOMTree,
				this.simplifiedDOMState,
			);

			// Only update internal state if keepPreviousState is false
			if (!keepPreviousState) {
				this.simplifiedDOMState = simplifiedDOMState;
			}

			this.logger.info("DOM tree analysis complete", {
				newNodesCount: simplifiedDOMState.stats.newSimplifiedNodesCount,
				totalNodesCountChange:
					simplifiedDOMState.stats.simplifiedNodesCountChange,
				stateUpdated: !keepPreviousState,
				newSelectorMapSize: Object.keys(simplifiedDOMState.selectorMap).length,
			});
			return {
				newNodesCount: simplifiedDOMState.stats.newSimplifiedNodesCount,
				totalNodesCountChange:
					simplifiedDOMState.stats.simplifiedNodesCountChange,
			};
		} catch (error) {
			this.logger.error(
				`Failed to get DOM tree with change detection: ${error}`,
			);
			// Don't update this.previousState on error
			throw error;
		}
	}

	/**
	 * Get service status
	 */
	getStatus() {
		return {
			isInitialized: true,
			isAttached: isDebuggerAttached(this.webContents),
			webContentsId: this.webContents.id,
		};
	}
}
