/**
 * Simplified DOM Service - Direct CDP integration following browser-use patterns
 *
 * Minimal abstraction with direct CDP access and simple timeout handling
 */

import type { WebContents } from "electron";
import log from "electron-log/main";

import type {
  IDOMService,
  EnhancedDOMTreeNode,
  TargetAllTrees,
  DOMSnapshot,
  SerializedDOMState,
  SerializationConfig,
  SerializationTiming,
  SerializationStats,
  DOMDocument,
  AXNode,
  EnhancedSnapshotNode,
  DOMRect,
} from "@shared/dom";
import { DOMTreeSerializer } from "./serializer/DOMTreeSerializer";

export class DOMService implements IDOMService {
  private webContents: WebContents;
  private logger = log.scope("DOMService");
  private serializer: DOMTreeSerializer;
  private previousState?: SerializedDOMState;

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.serializer = new DOMTreeSerializer();
    this.logger.info("DOMService initialized - direct CDP integration");
  }

  /**
   * Send CDP command with simple timeout
   */
  async sendCommand<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Command ${method} timed out after 10s`));
      }, 10000);

      this.webContents.debugger.sendCommand(method, params);

      const handleResponse = (
        _event: unknown,
        responseMethod: string,
        responseParams: unknown
      ) => {
        if (responseMethod === method || responseMethod.includes("error")) {
          clearTimeout(timeout);
          this.webContents.debugger.removeAllListeners("message");

          if (responseMethod.includes("error")) {
            reject(new Error(`Command ${method} failed`));
          } else {
            resolve(responseParams as T);
          }
        }
      };

      this.webContents.debugger.on("message", handleResponse);
    });
  }

  /**
   * Attach debugger
   */
  async attach(): Promise<void> {
    try {
      this.webContents.debugger.attach("1.3");
      this.logger.info("Debugger attached");
    } catch (error) {
      this.logger.error(`Failed to attach debugger: ${error}`);
      throw error;
    }
  }

  /**
   * Detach debugger
   */
  async detach(): Promise<void> {
    try {
      this.webContents.debugger.detach();
      this.logger.info("Debugger detached");
    } catch (error) {
      this.logger.error(`Failed to detach debugger: ${error}`);
      throw error;
    }
  }

  /**
   * Check if debugger is attached
   */
  isAttached(): boolean {
    return this.webContents.debugger.isAttached();
  }

  /**
   * Get enhanced DOM tree
   */
  async getDOMTree(): Promise<EnhancedDOMTreeNode> {
    if (!this.isAttached()) {
      throw new Error("Debugger not attached - call initialize() first");
    }

    try {
      this.logger.debug("Getting DOM tree");

      // Get all CDP data
      const trees = await this.getAllTrees();

      // Build enhanced tree directly
      const enhancedTree = this.buildEnhancedDOMTree(trees);

      this.logger.info(
        `DOM tree built with ${this.countNodes(enhancedTree)} nodes`
      );
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

      // Get DOM data in parallel
      const [domTree, snapshot, axTree] = await Promise.allSettled([
        this.sendCommand("DOM.getDocument", { depth: -1, pierce: true }),
        this.sendCommand("DOMSnapshot.captureSnapshot", {
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
        }),
        this.sendCommand("Accessibility.getFullAXTree"),
      ]);

      return {
        snapshot:
          snapshot.status === "fulfilled"
            ? (snapshot.value as DOMSnapshot)
            : { documents: [], strings: [] },
        domTree: domTree.status === "fulfilled" ? (domTree.value as DOMDocument) : null,
        axTree:
          axTree.status === "fulfilled"
            ? { nodes: (axTree.value as { nodes: AXNode[] }).nodes || [] }
            : { nodes: [] },
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
  private buildEnhancedDOMTree(trees: TargetAllTrees): EnhancedDOMTreeNode {
    const { snapshot, domTree, axTree } = trees;

    // Build lookups
    const axTreeLookup: Record<number, AXNode> = {};
    for (const axNode of axTree.nodes) {
      if (axNode.backendDOMNodeId) {
        axTreeLookup[axNode.backendDOMNodeId] = axNode;
      }
    }

    const snapshotLookup = this.buildSnapshotLookup(snapshot, 1.0);
    const nodeLookup: Record<number, EnhancedDOMTreeNode> = {};

    // Build enhanced tree
    if (!domTree) {
      throw new Error("DOM tree is null - cannot build enhanced tree");
    }
    return this.constructEnhancedNode(
      domTree.root,
      axTreeLookup,
      snapshotLookup,
      nodeLookup,
      "default"
    );
  }

  /**
   * Build snapshot lookup (simplified)
   */
  private buildSnapshotLookup(
    snapshot: DOMSnapshot,
    _devicePixelRatio: number
  ): Record<number, EnhancedSnapshotNode> {
    const lookup: Record<number, EnhancedSnapshotNode> = {};

    if (!snapshot.documents?.[0]) return lookup;

    const { nodeTree, layout } = snapshot.documents[0];
    if (!nodeTree?.backendNodeId || !layout?.nodeIndex) return lookup;

    for (let i = 0; i < nodeTree.backendNodeId.length; i++) {
      const nodeId = nodeTree.backendNodeId[i];
      const isClickable = nodeTree.isClickable?.index?.includes(i) || false;

      let bounds: DOMRect | null = null;
      let computedStyles: Record<string, string> | null = null;

      const layoutIdx = layout.nodeIndex.indexOf(i);
      if (
        layoutIdx >= 0 &&
        layout.bounds &&
        layout.bounds[layoutIdx]?.length >= 4
      ) {
        const boundsData = layout.bounds[layoutIdx];
        const [x, y, w, h] = boundsData;
        bounds = {
          x,
          y,
          width: w,
          height: h,
          x1: x,
          y1: y,
          x2: x + w,
          y2: y + h,
          area: w * h,
          toDict: function() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
        };
        if (layout.styles?.[layoutIdx]) {
          computedStyles = {};
        }
      }

      lookup[nodeId] = {
        bounds,
        computedStyles,
        isClickable,
      };
    }

    return lookup;
  }

  /**
   * Construct enhanced node (simplified)
   */
  private constructEnhancedNode(
    node: DOMDocument['root'],
    axTreeLookup: Record<number, AXNode>,
    snapshotLookup: Record<number, EnhancedSnapshotNode>,
    nodeLookup: Record<number, EnhancedDOMTreeNode>,
    targetId: string
  ): EnhancedDOMTreeNode {
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
      nodeValue: node.nodeValue || "",
      attributes,
      isScrollable: node.isScrollable || false,
      isVisible: undefined, // Will be calculated later
      absolutePosition: snapshotData?.bounds || null,
      targetId,
      frameId: node.frameId || null,
      sessionId: null,
      shadowRootType: node.shadowRootType || null,
      shadowRoots: [],
      parentNode: undefined,
      childrenNodes: [],
      contentDocument: null,
      axNode: axNode
        ? {
            axNodeId: axNode.nodeId,
            ignored: axNode.ignored,
            role: axNode.role?.value || null,
            name: axNode.name?.value || null,
            description: axNode.description?.value || null,
            properties: axNode.properties?.map(prop => ({
              name: prop.name,
              value: prop.value?.value ?? null
            })) || null,
            childIds: axNode.childIds || null,
          }
        : null,
      snapshotNode: snapshotData,
      elementIndex: null,
      _compoundChildren: [],
      uuid: Math.random().toString(36).substring(2, 15),

      // Simplified getters
      get tag() {
        return this.nodeName.toLowerCase();
      },
      get children() {
        return this.childrenNodes || [];
      },
      get childrenAndShadowRoots() {
        const children = [...(this.childrenNodes || [])];
        if (this.shadowRoots) children.push(...this.shadowRoots);
        return children;
      },
      get parent() {
        return this.parentNode || null;
      },
      get isActuallyScrollable() {
        return this.isScrollable || false;
      },
      get shouldShowScrollInfo(): boolean {
        return (this.isScrollable || false) && this.tag
          ? ["body", "html"].includes(this.tag)
          : false;
      },
      get scrollInfo() {
        return null;
      },
      get elementHash() {
        return 0;
      },
      get xpath() {
        return "";
      },
    };

    // Store in lookup
    nodeLookup[node.nodeId] = enhancedNode;

    // Process children recursively
    if (node.children && Array.isArray(node.children)) {
      enhancedNode.childrenNodes = [];
      for (const child of node.children) {
        const childNode = this.constructEnhancedNode(
          child.root,
          axTreeLookup,
          snapshotLookup,
          nodeLookup,
          targetId
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
   * Initialize the DOM service
   */
  async initialize(): Promise<void> {
    try {
      await this.attach();
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
      await this.detach();
      this.previousState = undefined;
      this.logger.info("DOMService destroyed");
    } catch (error) {
      this.logger.error("Error during DOMService destruction:", error);
    }
  }

  /**
   * Get the underlying debugger (for advanced usage)
   */
  getDebugger() {
    return this.webContents.debugger;
  }

  /**
   * Get the webContents instance
   */
  getWebContents(): WebContents {
    return this.webContents;
  }

  /**
   * Get viewport information (simplified)
   */
  async getViewportInfo() {
    return {
      width: 1920,
      height: 1080,
      devicePixelRatio: 1.0,
      scrollX: 0,
      scrollY: 0,
    };
  }

  /**
   * Get frame tree (simplified)
   */
  async getFrameTree() {
    return {
      frameTree: {
        frame: {
          id: "default",
          url: "",
          name: "",
          securityOrigin: "",
        },
      },
    };
  }

  /**
   * Get targets for current page (simplified)
   */
  async getTargetsForPage() {
    return {
      pageSession: {
        targetId: "default",
        type: "page",
        title: "",
        url: "",
        attached: true,
      },
      iframeSessions: [],
    };
  }

  /**
   * Check if the service is ready
   */
  isReady(): boolean {
    return this.isAttached();
  }

  /**
   * Get serialized DOM tree optimized for LLM consumption
   */
  async getSerializedDOMTree(
    previousState?: SerializedDOMState,
    config?: Partial<SerializationConfig>
  ): Promise<{
    serializedState: SerializedDOMState;
    timing: SerializationTiming;
    stats: SerializationStats;
  }> {
    if (!this.isAttached()) {
      throw new Error("Debugger not attached - call initialize() first");
    }

    try {
      this.logger.debug("Getting serialized DOM tree");

      const domTree = await this.getDOMTree();
      const result = await this.serializer.serializeDOMTree(
        domTree,
        previousState,
        config
      );

      this.previousState = result.serializedState;
      this.logger.info(
        `DOM tree serialized: ${result.stats.interactiveElements} interactive elements`
      );

      // Convert timing to expected format
      const convertedTiming: SerializationTiming = {
        total: result.timing.serialize_dom_tree_total,
        createSimplifiedTree: 0,
        paintOrderFiltering: 0,
        optimizeTreeStructure: 0,
        boundingBoxFiltering: 0,
        assignInteractiveIndices: 0,
        markNewElements: 0,
      };

      return {
        ...result,
        timing: convertedTiming,
      };
    } catch (error) {
      this.logger.error(`Failed to serialize DOM tree: ${error}`);
      throw error;
    }
  }

  /**
   * Get DOM tree with change detection
   */
  async getDOMTreeWithChangeDetection(
    previousState?: SerializedDOMState
  ): Promise<{
    domTree: EnhancedDOMTreeNode;
    serializedState?: SerializedDOMState;
    hasChanges: boolean;
    changeCount: number;
  }> {
    if (!this.isAttached()) {
      throw new Error("Debugger not attached - call initialize() first");
    }

    try {
      const domTree = await this.getDOMTree();

      if (!previousState) {
        const serializedResult = await this.serializer.serializeDOMTree(
          domTree
        );
        return {
          domTree,
          serializedState: serializedResult.serializedState,
          hasChanges: true,
          changeCount: serializedResult.stats.totalNodes,
        };
      }

      const serializedResult = await this.serializer.serializeDOMTree(
        domTree,
        previousState
      );
      const changeCount = serializedResult.stats.newElements;
      const hasChanges = changeCount > 0;

      return {
        domTree,
        serializedState: serializedResult.serializedState,
        hasChanges,
        changeCount,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get DOM tree with change detection: ${error}`
      );
      throw error;
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isInitialized: true,
      isAttached: this.isAttached(),
      webContentsId: this.webContents.id,
    };
  }

  /**
   * Get previous serialized state for change detection
   */
  getPreviousState(): SerializedDOMState | undefined {
    return this.previousState;
  }
}
