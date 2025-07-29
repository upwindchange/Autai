import { WebContents } from 'electron';
import type {
  DOMElementNode,
  DOMTextNode,
  DOMNode,
  SelectorMap,
  DOMState,
  BuildDomTreeArgs,
  JSNodeData,
  JSEvalResult,
  ViewportInfo,
  ActionResult
} from '../../../shared/types';

export class DomService {
  private webContents: WebContents;
  private logger: Console = console;

  constructor(webContents: WebContents) {
    this.webContents = webContents;
  }

  /**
   * Get clickable elements from the page DOM
   */
  async getClickableElements(
    highlightElements: boolean = true,
    focusElement: number = -1,
    viewportExpansion: number = 0
  ): Promise<DOMState> {
    const { elementTree, selectorMap } = await this._buildDomTree(
      highlightElements,
      focusElement,
      viewportExpansion
    );
    return { elementTree, selectorMap };
  }

  /**
   * Execute buildDomTree function in the page context
   */
  async buildDomTree(args?: Partial<BuildDomTreeArgs>): Promise<ActionResult> {
    try {
      const defaultArgs: BuildDomTreeArgs = {
        doHighlightElements: false,
        focusHighlightIndex: -1,
        viewportExpansion: 0,
        debugMode: true
      };
      
      const finalArgs = { ...defaultArgs, ...args };
      
      // Execute the buildDomTree function from the injected index.js
      const script = `
        (function() {
          if (typeof buildDomTree === 'function') {
            return buildDomTree(${JSON.stringify(finalArgs)});
          } else {
            throw new Error('buildDomTree function not found. Make sure index.js is injected.');
          }
        })()
      `;
      
      const result = await this.webContents.executeJavaScript(script);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to build DOM tree",
      };
    }
  }

  /**
   * Build DOM tree by executing JavaScript analysis and constructing the tree
   */
  private async _buildDomTree(
    highlightElements: boolean,
    focusElement: number,
    viewportExpansion: number
  ): Promise<{ elementTree: DOMElementNode; selectorMap: SelectorMap }> {
    // Check if JavaScript can be evaluated
    try {
      const testResult = await this.webContents.executeJavaScript('1+1');
      if (testResult !== 2) {
        throw new Error('The page cannot evaluate javascript code properly');
      }
    } catch (_error) {
      throw new Error('The page cannot evaluate javascript code properly');
    }

    // Short-circuit for new tab pages
    const currentUrl = this.webContents.getURL();
    if (this.isNewTabPage(currentUrl)) {
      return {
        elementTree: this.createEmptyDOMElement(),
        selectorMap: {}
      };
    }

    // Prepare arguments for JavaScript execution
    const debugMode = true; // Can be made configurable
    const args: BuildDomTreeArgs = {
      doHighlightElements: highlightElements,
      focusHighlightIndex: focusElement,
      viewportExpansion: viewportExpansion,
      debugMode: debugMode
    };

    try {
      this.logger.debug(`🔧 Starting JavaScript DOM analysis for ${currentUrl.substring(0, 50)}...`);
      
      // Execute buildDomTree with the provided arguments
      const result = await this.buildDomTree(args);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to build DOM tree');
      }

      const evalPage = result.data as JSEvalResult;
      this.logger.debug('✅ JavaScript DOM analysis completed');

      // Log performance metrics if available
      if (debugMode && evalPage.perfMetrics) {
        this.logPerformanceMetrics(currentUrl, evalPage);
      }

      this.logger.debug('🔄 Starting TypeScript DOM tree construction...');
      const domResult = await this._constructDomTree(evalPage);
      this.logger.debug('✅ TypeScript DOM tree construction completed');
      
      return domResult;
    } catch (error) {
      this.logger.error('Error evaluating JavaScript:', error);
      throw error;
    }
  }

  /**
   * Construct DOM tree from JavaScript evaluation result
   */
  private async _constructDomTree(
    evalPage: JSEvalResult
  ): Promise<{ elementTree: DOMElementNode; selectorMap: SelectorMap }> {
    const jsNodeMap = evalPage.map;
    const jsRootId = evalPage.rootId;

    const selectorMap: SelectorMap = {};
    const nodeMap: Map<string, DOMNode> = new Map();

    // First pass: create all nodes
    for (const [id, nodeData] of Object.entries(jsNodeMap)) {
      const { node } = this._parseNode(nodeData);
      if (node === null) {
        continue;
      }

      nodeMap.set(id, node);

      // Build selector map for interactive elements
      if (node.type === 'ELEMENT_NODE' && node.highlightIndex !== null && node.highlightIndex !== undefined) {
        selectorMap[node.highlightIndex] = node;
      }
    }

    // Second pass: build parent-child relationships
    for (const [id, nodeData] of Object.entries(jsNodeMap)) {
      const node = nodeMap.get(id);
      if (!node || node.type !== 'ELEMENT_NODE') {
        continue;
      }

      const childrenIds = nodeData.children || [];
      for (const childId of childrenIds) {
        const childNode = nodeMap.get(childId);
        if (!childNode) {
          continue;
        }

        childNode.parent = node;
        node.children.push(childNode);
      }
    }

    const rootNode = nodeMap.get(String(jsRootId));
    
    if (!rootNode || rootNode.type !== 'ELEMENT_NODE') {
      throw new Error('Failed to parse HTML to dictionary');
    }

    return { elementTree: rootNode, selectorMap };
  }

  /**
   * Parse a single node from JavaScript data
   */
  private _parseNode(
    nodeData: JSNodeData
  ): { node: DOMNode | null; childrenIds: string[] } {
    if (!nodeData) {
      return { node: null, childrenIds: [] };
    }

    // Process text nodes
    if (nodeData.type === 'TEXT_NODE') {
      const textNode: DOMTextNode = {
        type: 'TEXT_NODE',
        text: nodeData.text || '',
        isVisible: nodeData.isVisible || false,
        parent: null
      };
      return { node: textNode, childrenIds: [] };
    }

    // Process element nodes
    let viewportInfo: ViewportInfo | undefined;
    
    if (nodeData.viewport) {
      viewportInfo = {
        width: nodeData.viewport.width,
        height: nodeData.viewport.height
      };
    }

    const elementNode: DOMElementNode = {
      type: 'ELEMENT_NODE',
      tagName: nodeData.tagName || '',
      xpath: nodeData.xpath || '',
      attributes: nodeData.attributes || {},
      children: [],
      isVisible: nodeData.isVisible || false,
      isInteractive: nodeData.isInteractive || false,
      isTopElement: nodeData.isTopElement || false,
      isInViewport: nodeData.isInViewport || false,
      highlightIndex: nodeData.highlightIndex,
      shadowRoot: nodeData.shadowRoot || false,
      parent: null,
      viewportInfo: viewportInfo
    };

    const childrenIds = nodeData.children || [];

    return { node: elementNode, childrenIds };
  }

  /**
   * Check if URL is a new tab page
   */
  private isNewTabPage(url: string): boolean {
    return !url || 
           url === 'about:blank' || 
           url.startsWith('chrome://') || 
           url.startsWith('edge://') ||
           url.startsWith('about:');
  }

  /**
   * Create an empty DOM element for new tab pages
   */
  private createEmptyDOMElement(): DOMElementNode {
    return {
      type: 'ELEMENT_NODE',
      tagName: 'body',
      xpath: '',
      attributes: {},
      children: [],
      isVisible: false,
      isInteractive: false,
      isTopElement: false,
      isInViewport: false,
      shadowRoot: false,
      parent: null
    };
  }

  /**
   * Log performance metrics from DOM analysis
   */
  private logPerformanceMetrics(url: string, evalPage: JSEvalResult): void {
    const perf = evalPage.perfMetrics;
    if (!perf || !perf.nodeMetrics) {
      return;
    }

    const totalNodes = perf.nodeMetrics.totalNodes || 0;
    
    // Count interactive elements
    let interactiveCount = 0;
    for (const nodeData of Object.values(evalPage.map)) {
      if (nodeData.isInteractive) {
        interactiveCount++;
      }
    }

    const urlShort = url.length > 50 ? url.substring(0, 50) + '...' : url;
    this.logger.debug(
      `🔎 Ran buildDOMTree.js interactive element detection on: ${urlShort} interactive=${interactiveCount}/${totalNodes}`
    );
  }
}