/**
 * Iframe Processor - Cross-origin iframe support
 *
 * Advanced iframe processing with cross-origin detection, size filtering,
 * and independent target management following browser-use patterns.
 */

import type { EnhancedDOMTreeNode } from "@shared/dom";
import { IIframeProcessor } from "@shared/dom/interfaces";

/**
 * Iframe processing configuration
 */
interface IframeProcessorConfig {
  maxIframeDepth: number;
  minIframeSize: number;
  enableCrossOrigin: boolean;
  maxIframesPerPage: number;
  enableScrollSync: boolean;
}

/**
 * Iframe statistics
 */
interface IframeStats {
  totalIframes: number;
  processedIframes: number;
  skippedIframes: number;
  crossOriginIframes: number;
  depthViolations: number;
  sizeViolations: number;
}

/**
 * Iframe Processor implementation
 */
export class IframeProcessor implements IIframeProcessor {
  private readonly config: IframeProcessorConfig;
  private readonly stats: IframeStats;
  private processedTargets: Set<string>;

  constructor(config: Partial<IframeProcessorConfig> = {}) {
    this.config = {
      maxIframeDepth: 5,
      minIframeSize: 100,
      enableCrossOrigin: true,
      maxIframesPerPage: 20,
      enableScrollSync: true,
      ...config
    };

    this.stats = {
      totalIframes: 0,
      processedIframes: 0,
      skippedIframes: 0,
      crossOriginIframes: 0,
      depthViolations: 0,
      sizeViolations: 0
    };

    this.processedTargets = new Set();
  }

  /**
   * Process cross-origin iframes in DOM tree
   */
  async processIframes(root: EnhancedDOMTreeNode): Promise<EnhancedDOMTreeNode> {
    this.resetStats();
    const issues: string[] = [];

    try {
      const result = await this.processIframesRecursive(root, 0, issues);

      this.stats.processedIframes = this.stats.totalIframes - this.stats.skippedIframes;

      if (issues.length > 0) {
        this.logIframeIssues(issues);
      }

      return result.root;
    } catch (error) {
      throw new Error(`Iframe processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if iframe should be processed
   */
  shouldProcessIframe(node: EnhancedDOMTreeNode): boolean {
    // Must be an iframe element
    if (node.tag !== 'iframe') {
      return false;
    }

    // Check size requirements
    if (!this.meetsSizeRequirements(node)) {
      this.stats.sizeViolations++;
      return false;
    }

    // Check if already processed
    const targetId = this.extractTargetId(node);
    if (this.processedTargets.has(targetId)) {
      return false;
    }

    // Check cross-origin restrictions
    if (this.isCrossOrigin(node) && !this.config.enableCrossOrigin) {
      this.stats.crossOriginIframes++;
      return false;
    }

    return true;
  }

  /**
   * Get iframe processing statistics
   */
  getIframeStats(): IframeStats {
    return { ...this.stats };
  }

  /**
   * Process iframes recursively with depth tracking
   */
  private async processIframesRecursive(
    node: EnhancedDOMTreeNode,
    depth: number,
    issues: string[]
  ): Promise<{ root: EnhancedDOMTreeNode; issues: string[] }> {
    // Check depth limit
    if (depth > this.config.maxIframeDepth) {
      this.stats.depthViolations++;
      issues.push(`Iframe depth limit exceeded (${depth} > ${this.config.maxIframeDepth})`);
      return { root: node, issues };
    }

    // Process current node if it's an iframe
    if (node.tag === 'iframe') {
      this.stats.totalIframes++;

      if (this.shouldProcessIframe(node)) {
        try {
          const processedIframe = await this.processSingleIframe(node);
          node.contentDocument = processedIframe;
          this.processedTargets.add(this.extractTargetId(node));
        } catch (error) {
          this.stats.skippedIframes++;
          issues.push(`Failed to process iframe: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      } else {
        this.stats.skippedIframes++;
      }
    }

    // Process children recursively
    if (node.childrenNodes) {
      for (const child of node.childrenNodes) {
        await this.processIframesRecursive(child, depth + 1, issues);
      }
    }

    // Process shadow roots
    if (node.shadowRoots) {
      for (const shadowRoot of node.shadowRoots) {
        await this.processIframesRecursive(shadowRoot, depth + 1, issues);
      }
    }

    return { root: node, issues };
  }

  /**
   * Process a single iframe element
   */
  private async processSingleIframe(
    iframeNode: EnhancedDOMTreeNode
  ): Promise<EnhancedDOMTreeNode> {
    const targetId = this.extractTargetId(iframeNode);

    if (this.processedTargets.has(targetId)) {
      throw new Error('Iframe already processed');
    }

    // In a real implementation, this would:
    // 1. Create new CDP session for the iframe target
    // 2. Extract DOM tree from the iframe
    // 3. Process nested iframes recursively
    // 4. Handle cross-origin restrictions
    // 5. Synchronize scroll positions if needed

    // For now, return a placeholder structure
    return this.createPlaceholderIframeContent(iframeNode);
  }

  /**
   * Extract target ID from iframe node
   */
  private extractTargetId(node: EnhancedDOMTreeNode): string {
    // Try to extract a unique identifier for the iframe
    const src = node.attributes.src || '';
    const name = node.attributes.name || '';
    const id = node.attributes.id || '';

    return `iframe_${src}_${name}_${id}_${node.nodeId}`;
  }

  /**
   * Check if iframe meets size requirements
   */
  private meetsSizeRequirements(node: EnhancedDOMTreeNode): boolean {
    const bounds = node.snapshotNode?.bounds;

    if (!bounds) {
      return false;
    }

    const width = bounds.width || 0;
    const height = bounds.height || 0;

    return width >= this.config.minIframeSize && height >= this.config.minIframeSize;
  }

  /**
   * Check if iframe is cross-origin
   */
  private isCrossOrigin(node: EnhancedDOMTreeNode): boolean {
    const src = node.attributes.src;

    if (!src) {
      // Data URIs or srcless iframes are considered same-origin
      return false;
    }

    // Check if src starts with http/https and differs from current page
    // This is a simplified check - real implementation would need full origin comparison
    if (src.startsWith('http://') || src.startsWith('https://')) {
      // In a real implementation, compare with current page origin
      return true; // Assume cross-origin for external URLs
    }

    // Same-origin iframes
    return false;
  }

  /**
   * Create placeholder iframe content for demonstration
   */
  private createPlaceholderIframeContent(iframeNode: EnhancedDOMTreeNode): EnhancedDOMTreeNode {
    const src = iframeNode.attributes.src || 'about:blank';
    const isCrossOrigin = this.isCrossOrigin(iframeNode);

    return {
      nodeId: -1, // Special ID for iframe content
      backendNodeId: -1,
      nodeType: 9, // Document node
      nodeName: '#document',
      nodeValue: '',
      attributes: {},
      isScrollable: false,
      isVisible: true,
      absolutePosition: iframeNode.absolutePosition || null,
      targetId: this.extractTargetId(iframeNode),
      frameId: iframeNode.frameId,
      sessionId: iframeNode.sessionId,
      contentDocument: null,
      shadowRootType: null,
      shadowRoots: null,
      parentNode: null,
      childrenNodes: [{
        nodeId: -2,
        backendNodeId: -2,
        nodeType: 1, // Element node
        nodeName: 'HTML',
        nodeValue: '',
        attributes: { 'data-iframe-src': src },
        isScrollable: false,
        isVisible: true,
        absolutePosition: iframeNode.absolutePosition || null,
        targetId: this.extractTargetId(iframeNode),
        frameId: iframeNode.frameId,
        sessionId: iframeNode.sessionId,
        contentDocument: null,
        shadowRootType: null,
        shadowRoots: null,
        parentNode: null,
        childrenNodes: [{
          nodeId: -3,
          backendNodeId: -3,
          nodeType: 1,
          nodeName: 'BODY',
          nodeValue: '',
          attributes: {
            'data-iframe-processed': 'true',
            'data-iframe-cross-origin': isCrossOrigin.toString(),
            'data-iframe-size': `${this.config.minIframeSize}x${this.config.minIframeSize}`
          },
          isScrollable: false,
          isVisible: true,
          absolutePosition: iframeNode.absolutePosition || null,
          targetId: this.extractTargetId(iframeNode),
          frameId: iframeNode.frameId,
          sessionId: iframeNode.sessionId,
          contentDocument: null,
          shadowRootType: null,
          shadowRoots: null,
          parentNode: null,
          childrenNodes: [{
            nodeId: -4,
            backendNodeId: -4,
            nodeType: 1,
            nodeName: 'DIV',
            nodeValue: '',
            attributes: {
              'data-iframe-placeholder': 'true',
              'class': 'iframe-content-placeholder'
            },
            isScrollable: false,
            isVisible: true,
            absolutePosition: iframeNode.absolutePosition || null,
            targetId: this.extractTargetId(iframeNode),
            frameId: iframeNode.frameId,
            sessionId: iframeNode.sessionId,
            contentDocument: null,
            shadowRootType: null,
            shadowRoots: null,
            parentNode: null,
            childrenNodes: [],
            axNode: {
              axNodeId: `iframe-placeholder-${iframeNode.nodeId}`,
              ignored: false,
              role: 'iframe',
              name: `Iframe content: ${src}`,
              description: isCrossOrigin ? 'Cross-origin iframe' : 'Same-origin iframe',
              properties: [
                { name: 'roledescription', value: 'Iframe content placeholder' }
              ]
            },
            snapshotNode: null,
            elementIndex: null,
            _compoundChildren: [],
            tag: 'div',
            xpath: `//div[@data-iframe-placeholder="true"]`,
            get children() { return this.childrenNodes || []; },
            get childrenAndShadowRoots() { return this.childrenNodes || []; },
            get parent() { return this.parentNode || null; },
            get isActuallyScrollable() { return false; },
            get shouldShowScrollInfo() { return false; },
            get scrollInfo() { return null; },
            get elementHash() { return Math.random(); }
          }],
          axNode: null,
          snapshotNode: null,
          elementIndex: null,
          _compoundChildren: [],
          tag: 'body',
          xpath: '//body',
          get children() { return this.childrenNodes || []; },
          get childrenAndShadowRoots() { return this.childrenNodes || []; },
          get parent() { return this.parentNode || null; },
          get isActuallyScrollable() { return false; },
          get shouldShowScrollInfo() { return false; },
          get scrollInfo() { return null; },
          get elementHash() { return Math.random(); }
        }],
        axNode: null,
        snapshotNode: null,
        elementIndex: null,
        _compoundChildren: [],
        tag: 'body',
        xpath: '//body',
        get children() { return this.childrenNodes || []; },
        get childrenAndShadowRoots() { return this.childrenNodes || []; },
        get parent() { return this.parentNode || null; },
        get isActuallyScrollable() { return false; },
        get shouldShowScrollInfo() { return false; },
        get scrollInfo() { return null; },
        get elementHash() { return Math.random(); }
      }],
      axNode: null,
      snapshotNode: null,
      elementIndex: null,
      _compoundChildren: [],
      tag: 'html',
      xpath: '/html',
      get children() { return this.childrenNodes || []; },
      get childrenAndShadowRoots() { return this.childrenNodes || []; },
      get parent() { return this.parentNode || null; },
      get isActuallyScrollable() { return false; },
      get shouldShowScrollInfo() { return false; },
      get scrollInfo() { return null; },
      get elementHash() { return Math.random(); }
    };
  }

  /**
   * Log iframe processing issues
   */
  private logIframeIssues(issues: string[]): void {
    if (issues.length === 0) return;

    console.warn('Iframe processing issues detected:');
    issues.forEach((issue, index) => {
      console.warn(`  ${index + 1}. ${issue}`);
    });
  }

  /**
   * Reset processing statistics
   */
  private resetStats(): void {
    this.stats.totalIframes = 0;
    this.stats.processedIframes = 0;
    this.stats.skippedIframes = 0;
    this.stats.crossOriginIframes = 0;
    this.stats.depthViolations = 0;
    this.stats.sizeViolations = 0;
    this.processedTargets.clear();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<IframeProcessorConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Get current configuration
   */
  getConfig(): IframeProcessorConfig {
    return { ...this.config };
  }

  /**
   * Clear processed targets cache
   */
  clearProcessedTargets(): void {
    this.processedTargets.clear();
  }
}