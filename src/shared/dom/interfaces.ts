/**
 * DOM service interfaces for CDP infrastructure
 * Simplified version without CDPService abstraction
 */

import type { Debugger, WebContents } from "electron";
import type { SessionInfo, CDPOptions, CurrentPageTargets, FrameTree } from "./types";

export interface ICDPSessionManager {
  /**
   * Create a new CDP session
   */
  createSession(targetId?: string): Promise<string>;

  /**
   * Destroy an existing session
   */
  destroySession(sessionId: string): Promise<void>;

  /**
   * Get all active sessions
   */
  getActiveSessions(): Map<string, SessionInfo>;

  /**
   * Check if session exists
   */
  hasSession(sessionId: string): boolean;

  /**
   * Send command through specific session
   */
  sendSessionCommand<T = unknown>(
    sessionId: string,
    method: string,
    params?: unknown
  ): Promise<T>;

  /**
   * Cleanup all sessions
   */
  cleanup(): Promise<void>;

  /**
   * Get the number of active sessions
   */
  getSessionCount(): number;

  /**
   * Get targets for the current page
   */
  getTargetsForPage(targetId?: string): Promise<CurrentPageTargets>;

  /**
   * Get frame tree for a target
   */
  getFrameTree(targetId?: string): Promise<FrameTree[]>;

  /**
   * Get frame information by frame ID
   */
  getFrameInfo(frameId: string, targetId?: string): Promise<FrameTree | null>;

  /**
   * Check if frame has cross-origin content
   */
  isCrossOriginFrame(frameId: string, targetId?: string): Promise<boolean>;

  /**
   * Clear frame and target caches
   */
  clearCaches(): void;
}

export interface IDOMService {
  /**
   * Get the session manager instance
   */
  getSessionManager(): ICDPSessionManager;

  /**
   * Get the webContents instance
   */
  getWebContents(): WebContents;

  /**
   * Send a CDP command with retry logic
   */
  sendCommand<T = unknown>(
    method: string,
    params?: unknown,
    options?: CDPOptions
  ): Promise<T>;

  /**
   * Get the underlying debugger (for advanced usage)
   */
  getDebugger(): Debugger;

  /**
   * Attach the debugger to the webContents
   */
  attach(protocolVersion?: string): Promise<void>;

  /**
   * Detach the debugger from the webContents
   */
  detach(): Promise<void>;

  /**
   * Check if debugger is attached
   */
  isAttached(): boolean;

  /**
   * Cleanup resources
   */
  destroy(): Promise<void>;
}
