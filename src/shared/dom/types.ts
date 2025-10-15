/**
 * Core DOM types for CDP infrastructure
 */

export interface DOMRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SessionInfo {
  sessionId: string;
  targetId?: string;
  isAttached: boolean;
  createdAt: Date;
}

export interface CDPOptions {
  protocolVersion?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}
