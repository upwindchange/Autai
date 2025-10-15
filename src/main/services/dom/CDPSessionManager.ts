/**
 * CDP Session Manager - Simplified implementation
 *
 * Manages multiple CDP sessions for cross-origin iframe analysis.
 */

import { v4 as uuidv4 } from "uuid";
import log from "electron-log/main";

import type { ICDPSessionManager } from "@shared/dom";
import type { SessionInfo } from "@shared/dom";
import { DOMService } from "@/services/dom";

export class CDPSessionManager implements ICDPSessionManager {
  private domService: DOMService; // Using any to avoid circular dependency with DOMService
  private sessions: Map<string, SessionInfo> = new Map();
  private logger = log.scope("CDPSessionManager");

  constructor(domService: DOMService) {
    this.domService = domService;
    this.setupEventHandlers();
    this.logger.debug("CDPSessionManager initialized");
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
   * Setup event handlers for DOM service events
   */
  private setupEventHandlers(): void {
    // Phase 1: No event handling since DOMService is not an EventEmitter
    // In future phases, this could be extended to handle DOM service events
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
