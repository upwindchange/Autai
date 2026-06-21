/**
 * Server-initiated push event definitions, shared between the main-process
 * EventBus (emitter + SSE route) and the renderer httpClient (subscriber).
 *
 * These are the events that were previously delivered via
 * `webContents.send(...)` and are now delivered over the `GET /events` SSE
 * stream so that any HTTP client (including the bundled renderer) can receive
 * them.
 */

import type { AppMessage } from "./ipc";
import type { TagRow } from "./tag";

export interface ThreadMetadataPayload {
  threadId: string;
  title: string;
  tags?: TagRow[];
}

export interface ThreadSuggestionsPayload {
  threadId: string;
  suggestions: { prompt: string }[];
}

/**
 * Map of event name -> payload. Every event carries exactly one payload
 * (use `null` for events with no data, e.g. `splitview:activate`).
 */
export interface ServerEvents {
  "splitview:activate": null;
  "threads:listChanged": null;
  "threads:metadataUpdated": ThreadMetadataPayload;
  "threads:suggestionsUpdated": ThreadSuggestionsPayload;
  "app:message": AppMessage;
}

export type ServerEventName = keyof ServerEvents;

/**
 * Runtime list of all server push event names. Used by the SSE route (main)
 * and the ServerEventManager (renderer) to enumerate the events carried over
 * the `GET /events` stream.
 */
export const SERVER_EVENT_NAMES: readonly ServerEventName[] = [
  "splitview:activate",
  "threads:listChanged",
  "threads:metadataUpdated",
  "threads:suggestionsUpdated",
  "app:message",
];
