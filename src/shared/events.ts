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

export interface ChaptersChangedPayload {
  threadId: string;
}

/**
 * Payload for `entertainment:wallPrompt`: a chaptered internet fetch hit a
 * wall (login / paywall / captcha / age gate) and parked, asking the reader
 * to step in or skip. `ask` = the card, `stepping` = the user is working in
 * the split view (slim banner), `cleared` = dismissed (answered / thread
 * switched) — the reader drops the card.
 */
export interface WallPromptPayload {
  id: string;
  threadId: string;
  chapterNumber: number;
  host: string;
  reason: string;
  state: "ask" | "stepping" | "cleared";
}

/**
 * Payload for the `app:message` server-push event: a toast notification shown
 * to the user (info / alert / warning / success). `alert` is a fatal, persistent
 * error; `warning` is a non-fatal partial failure the workflow recovers from.
 */
export interface AppMessage {
  type: "info" | "alert" | "warning" | "success";
  title: string;
  description: string;
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
  "entertainment:chaptersChanged": ChaptersChangedPayload;
  "entertainment:wallPrompt": WallPromptPayload;
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
  "entertainment:chaptersChanged",
  "entertainment:wallPrompt",
];
