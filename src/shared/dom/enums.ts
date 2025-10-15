/**
 * Enums and constants for DOM services
 */

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

export enum SessionState {
  CREATED = 'created',
  ATTACHED = 'attached',
  DETACHED = 'detached',
  DESTROYED = 'destroyed',
}

// Default configuration values
export const DEFAULT_CDP_CONFIG = {
  PROTOCOL_VERSION: '1.3',
  TIMEOUT: 10000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  RETRY_BACKOFF_MULTIPLIER: 2,
} as const;

// CDP error messages
export const CDP_ERROR_MESSAGES = {
  ALREADY_ATTACHED: 'Debugger is already attached',
  NOT_ATTACHED: 'Debugger is not attached',
  TARGET_CLOSED: 'Target closed',
  INVALID_SESSION: 'Invalid session',
  COMMAND_FAILED: 'Command failed',
  TIMEOUT: 'Request timeout',
  CONNECTION_ERROR: 'Connection error',
} as const;

// Event names
export const CDP_INTERNAL_EVENTS = {
  SESSION_CREATED: 'cdp:session-created',
  SESSION_DESTROYED: 'cdp:session-destroyed',
  CONNECTION_STATE_CHANGED: 'cdp:connection-state-changed',
  ERROR_OCCURRED: 'cdp:error-occurred',
} as const;