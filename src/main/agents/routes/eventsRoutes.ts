import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eventBus } from "@/utils/eventBus";
import {
  SERVER_EVENT_NAMES,
  type ServerEventName,
} from "@shared/events";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Events");
export const eventsRoutes = new Hono();

/**
 * GET /events — server-initiated push stream (SSE).
 *
 * Forwards every `eventBus` emission to the client as a named SSE event with a
 * monotonically increasing `id` (so EventSource can resume via Last-Event-ID).
 * Clients auto-reconnect; on reconnect they refetch current state via the REST
 * endpoints rather than rely on server-side replay.
 *
 * Subscriptions are derived from SERVER_EVENT_NAMES so the bridge forwards
 * EVERY event in the map. A previous hand-listed version silently dropped
 * `threads:listChanged` (emitted on thread create/delete/archive), so clients
 * never reloaded their thread lists mid-session — e.g. a thread created by a
 * failed chat stayed out of tagStore and the sidebar's Select All skipped it,
 * while successful chats were synced only via the metadataUpdated side door.
 */
eventsRoutes.get("/", (c) => {
  const signal = c.req.raw.signal;

  return streamSSE(c, async (stream) => {
    let seq = Number(c.req.header("Last-Event-ID") ?? 0) || 0;

    const forward = (event: ServerEventName) => {
      const listener = (payload: unknown) => {
        seq += 1;
        void stream.writeSSE({
          id: String(seq),
          event,
          data: JSON.stringify(payload ?? null),
        });
      };
      eventBus.onEvent(event, listener);
      return listener;
    };

    const listeners = SERVER_EVENT_NAMES.map((name) => [name, forward(name)] as const);

    // Keep idle proxies/dev-server from dropping the connection.
    const heartbeat = setInterval(() => {
      void stream.writeSSE({ id: String(seq), event: "ping", data: "" });
    }, 25000);

    const cleanup = () => {
      clearInterval(heartbeat);
      for (const [name, listener] of listeners) {
        eventBus.offEvent(name, listener);
      }
    };
    signal.addEventListener("abort", cleanup, { once: true });

    // Hold the stream open until the client disconnects (request aborts).
    if (!signal.aborted) {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }

    cleanup();
    logger.debug("SSE client disconnected");
  });
});
