/**
 * Server-initiated push event definitions, shared between the main-process
 * EventBus (emitter + SSE route) and the renderer httpClient (subscriber).
 *
 * These are the events that were previously delivered via
 * `webContents.send(...)` and are now delivered over the `GET /events` SSE
 * stream so that any HTTP client (including the bundled renderer) can receive
 * them.
 */

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
 * Payload for the `app:message` server-push event: a toast notification shown
 * to the user (info / alert / success).
 */
export interface AppMessage {
  type: "info" | "alert" | "success";
  title: string;
  description: string;
}

/**
 * Payload for `entertainment:chapterReady`: fired when the worker has written
 * chapter row(s) to the DB. The frontend re-reads the chapter list from disk on
 * receipt. There is NO streaming — this single event is the only signal.
 *
 * `chapterId` is set for a single-chapter generation; it is omitted when the
 * event represents a thread-wide change (e.g. file ingestion populated many
 * rows at once), in which case the store reloads the whole list.
 */
export interface ChapterReadyPayload {
  threadId: string;
  chapterId?: string;
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
  "entertainment:chapterReady": ChapterReadyPayload;
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
  "entertainment:chapterReady",
];
