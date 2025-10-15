/**
 * CDP Session Manager - Simplified implementation
 *
 * Manages multiple CDP sessions for cross-origin iframe analysis.
 */

import { v4 as uuidv4 } from "uuid";
import log from "electron-log/main";

import type { ICDPSessionManager } from "@shared/dom";
import type { SessionInfo, FrameTree, CurrentPageTargets } from "@shared/dom";
import { DOMService } from "@/services/dom";

export class CDPSessionManager implements ICDPSessionManager {
  private domService: DOMService; // Using any to avoid circular dependency with DOMService
  private sessions: Map<string, SessionInfo> = new Map();
  private logger = log.scope("CDPSessionManager");
  private frameTreeCache: Map<string, FrameTree[]> = new Map();
  private targetCache: Map<string, CurrentPageTargets> = new Map();

  constructor(domService: DOMService) {
    this.domService = domService;
    this.setupEventHandlers();
    this.logger.debug("CDPSessionManager initialized (Phase 2 - enhanced)");
  }

  /**
   * Create a new CDP session
   */
  async createSession(targetId?: string): Promise<string> {
    const sessionId = uuidv4();

    try {
      this.logger.debug(
        `Creating CDP session ${sessionId} for target ${targetId || "default"}`
      );

      // For Phase 1, we'll use the main session
      // In future phases, this would create actual separate sessions using Target.attachToTarget
      const sessionInfo: SessionInfo = {
        sessionId,
        targetId,
        isAttached: true,
        createdAt: new Date(),
      };

      this.sessions.set(sessionId, sessionInfo);
      this.logger.info(`CDP session created: ${sessionId}`);

      // Session created - in Phase 1 we don't emit events since DOMService is not an EventEmitter

      return sessionId;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Failed to create session ${sessionId}: ${errorMessage}`
      );
      throw new Error(`Session creation failed: ${errorMessage}`);
    }
  }

  /**
   * Destroy an existing session
   */
  async destroySession(sessionId: string): Promise<void> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) {
      this.logger.warn(`Session ${sessionId} not found`);
      return;
    }

    try {
      this.logger.debug(`Destroying CDP session: ${sessionId}`);

      // For Phase 1, just remove from our map
      // In future phases, this would use Target.detachFromTarget
      this.sessions.delete(sessionId);
      this.logger.info(`CDP session destroyed: ${sessionId}`);

    // Session destroyed - in Phase 1 we don't emit events since DOMService is not an EventEmitter
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Failed to destroy session ${sessionId}: ${errorMessage}`
      );
      throw new Error(`Session destruction failed: ${errorMessage}`);
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): Map<string, SessionInfo> {
    return new Map(this.sessions);
  }

  /**
   * Check if session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Send command through specific session
   */
  async sendSessionCommand<T = unknown>(
    sessionId: string,
    method: string,
    params?: unknown
  ): Promise<T> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!sessionInfo.isAttached) {
      throw new Error(`Session ${sessionId} is not attached`);
    }

    this.logger.debug(`Sending command ${method} through session ${sessionId}`);

    // For Phase 1, we'll send through the DOM service
    // In future phases, this would use the specific session
    return (
      this.domService.sendCommand?.(method, params) ||
      Promise.reject(new Error("DOMService sendCommand not available"))
    );
  }

  /**
   * Cleanup all sessions
   */
  async cleanup(): Promise<void> {
    this.logger.debug("Cleaning up all CDP sessions");

    const sessionIds = Array.from(this.sessions.keys());
    const destroyPromises = sessionIds.map((sessionId) =>
      this.destroySession(sessionId).catch((error) => {
        this.logger.error(`Error destroying session ${sessionId}:`, error);
      })
    );

    await Promise.allSettled(destroyPromises);
    this.sessions.clear();
    this.logger.debug("CDPSessionManager cleanup completed");
  }

  /**
   * Get session information
   */
  getSessionInfo(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions for a specific target
   */
  getSessionsForTarget(targetId: string): SessionInfo[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.targetId === targetId
    );
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get frame tree for a target
   */
  async getFrameTree(targetId?: string): Promise<FrameTree[]> {
    const cacheKey = targetId || "default";

    // Check cache first
    if (this.frameTreeCache.has(cacheKey)) {
      return this.frameTreeCache.get(cacheKey)!;
    }

    try {
      this.logger.debug(`Getting frame tree for target: ${targetId || "default"}`);

      // Use DOM service to get frame tree
      const frameTreeData = await this.domService.sendCommand("Page.getFrameTree") as {
        frameTree: {
          frame: { id: string; url: string; name?: string; securityOrigin?: string };
          childFrames?: unknown[];
          parent?: unknown;
        };
      };

      // Parse frame tree into our format
      const frameTrees = this.parseFrameTree(frameTreeData.frameTree);

      // Cache the result
      this.frameTreeCache.set(cacheKey, frameTrees);

      this.logger.debug(`Found ${frameTrees.length} frames for target ${targetId || "default"}`);
      return frameTrees;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to get frame tree: ${errorMessage}`);
      throw new Error(`Frame tree detection failed: ${errorMessage}`);
    }
  }

  /**
   * Get targets for the current page
   */
  async getTargetsForPage(targetId?: string): Promise<CurrentPageTargets> {
    const cacheKey = targetId || "default";

    // Check cache first
    if (this.targetCache.has(cacheKey)) {
      return this.targetCache.get(cacheKey)!;
    }

    try {
      this.logger.debug(`Getting targets for page: ${targetId || "default"}`);

      // Get all targets
      const targetsData = await this.domService.sendCommand("Target.getTargets") as {
        targetInfos: Array<{
          targetId: string;
          type: string;
          title: string;
          url: string;
          attached: boolean;
        }>;
      };

      // Find main page target
      const mainTargetId = targetId || await this.getCurrentTargetId();
      if (!mainTargetId) {
        throw new Error("No current target ID available");
      }

      const mainTarget = targetsData.targetInfos.find(
        (target) => target.targetId === mainTargetId
      );

      if (!mainTarget) {
        throw new Error(`Main target not found: ${mainTargetId}`);
      }

      // Get frame tree to find iframe targets
      const frameTrees = await this.getFrameTree(mainTargetId);

      // Find iframe targets that belong to this page
      const iframeTargets: Array<{
        targetId: string;
        type: string;
        title: string;
        url: string;
        attached: boolean;
      }> = [];

      for (const frameInfo of frameTrees) {
        if (frameInfo.isCrossOrigin && frameInfo.frameTargetId) {
          // Check if this frame belongs to our target
          const parentTargetId = frameInfo.parentTargetId || frameInfo.frameTargetId;
          if (parentTargetId === mainTargetId) {
            const iframeTarget = targetsData.targetInfos.find(
              (target) => target.targetId === frameInfo.frameTargetId
            );
            if (iframeTarget) {
              iframeTargets.push(iframeTarget);
            }
          }
        }
      }

      const targets: CurrentPageTargets = {
        pageSession: mainTarget,
        iframeSessions: iframeTargets,
      };

      // Cache the result
      this.targetCache.set(cacheKey, targets);

      this.logger.debug(
        `Found ${iframeTargets.length} iframe targets for page ${mainTargetId}`
      );

      return targets;
    } catch (_error) {
      const errorMessage = "Target detection failed";
      this.logger.error(`Failed to get targets for page: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  /**
   * Get current target ID from DOM service
   */
  private async getCurrentTargetId(): Promise<string | null> {
    try {
      // For Phase 2, we'll use a default approach
      // In future phases, this could be enhanced to track current target
      return "default";
    } catch (_error) {
      this.logger.warn("Failed to get current target ID");
      return null;
    }
  }

  /**
   * Parse frame tree data from CDP into our format
   */
  private parseFrameTree(frameTreeNode: {
    frame: { id: string; url: string; name?: string; securityOrigin?: string };
    childFrames?: unknown[];
    parent?: unknown;
  }): FrameTree[] {
    const frames: FrameTree[] = [];

    const parseNode = (node: {
      frame: { id: string; url: string; name?: string; securityOrigin?: string };
      childFrames?: unknown[];
      parent?: unknown;
    }, parentId?: string): void => {
      const frame: FrameTree = {
        frameId: node.frame.id,
        parentId,
        url: node.frame.url || "",
        name: node.frame.name || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        isCrossOrigin: this.detectCrossOrigin(node as any),
        frameTargetId: null, // Will be determined by target comparison
        parentTargetId: parentId || null,
        children: [],
      };

      frames.push(frame);

      // Process children
      if (node.childFrames) {
        for (const child of node.childFrames) {
          parseNode(child as typeof node, frame.frameId);
        }
      }
    };

    if (frameTreeNode) {
      parseNode(frameTreeNode);
    }

    return frames;
  }

  /**
   * Detect if frame is cross-origin
   */
  private detectCrossOrigin(frameNode: {
    frame: { url: string; securityOrigin?: string };
    parent?: { frame?: { securityOrigin?: string } };
  }): boolean {
    // Basic detection - in future phases this could be enhanced
    // For now, we'll assume frames with different security origins are cross-origin
    try {
      // This is a simplified check - proper detection would require more complex logic
      return frameNode.frame.securityOrigin !== frameNode.parent?.frame?.securityOrigin;
    } catch {
      // If we can't parse the URL, assume it might be cross-origin
      return true;
    }
  }

  /**
   * Clear frame and target caches
   */
  clearCaches(): void {
    this.frameTreeCache.clear();
    this.targetCache.clear();
    this.logger.debug("CDP session caches cleared");
  }

  /**
   * Get frame information by frame ID
   */
  async getFrameInfo(frameId: string, targetId?: string): Promise<FrameTree | null> {
    const frameTrees = await this.getFrameTree(targetId);
    return frameTrees.find(frame => frame.frameId === frameId) || null;
  }

  /**
   * Check if frame has cross-origin content
   */
  async isCrossOriginFrame(frameId: string, targetId?: string): Promise<boolean> {
    const frameInfo = await this.getFrameInfo(frameId, targetId);
    return frameInfo?.isCrossOrigin || false;
  }

  /**
   * Setup event handlers for DOM service events
   */
  private setupEventHandlers(): void {
    // Phase 2: Enhanced event handling for frame navigation
    // In future phases, this could be extended to handle frame lifecycle events
  }

  
  /**
   * Get session statistics
   */
  getSessionStats(): {
    totalSessions: number;
    attachedSessions: number;
    sessionsByTarget: Record<string, number>;
  } {
    const sessionsByTarget: Record<string, number> = {};
    let attachedSessions = 0;

    for (const session of this.sessions.values()) {
      if (session.isAttached) {
        attachedSessions++;
      }

      const targetId = session.targetId || "default";
      sessionsByTarget[targetId] = (sessionsByTarget[targetId] || 0) + 1;
    }

    return {
      totalSessions: this.sessions.size,
      attachedSessions,
      sessionsByTarget,
    };
  }
}
