import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eventBus } from "@/utils/eventBus";
import type { ServerEventName, ServerEvents } from "@shared/events";
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
 */
eventsRoutes.get("/", (c) => {
  const signal = c.req.raw.signal;

  return streamSSE(c, async (stream) => {
    let seq = Number(c.req.header("Last-Event-ID") ?? 0) || 0;

    const send = <K extends ServerEventName>(
      event: K,
      data: ServerEvents[K],
    ) => {
      seq += 1;
      return stream.writeSSE({
        id: String(seq),
        event,
        data: JSON.stringify(data),
      });
    };

    const onMeta = (p: ServerEvents["threads:metadataUpdated"]) =>
      void send("threads:metadataUpdated", p);
    const onSugg = (p: ServerEvents["threads:suggestionsUpdated"]) =>
      void send("threads:suggestionsUpdated", p);
    const onMsg = (p: ServerEvents["app:message"]) =>
      void send("app:message", p);
    const onSplit = () => void send("splitview:activate", null);
    const onListChanged = () => void send("threads:listChanged", null);

    eventBus.onEvent("threads:metadataUpdated", onMeta);
    eventBus.onEvent("threads:suggestionsUpdated", onSugg);
    eventBus.onEvent("app:message", onMsg);
    eventBus.onEvent("splitview:activate", onSplit);
    eventBus.onEvent("threads:listChanged", onListChanged);

    // Keep idle proxies/dev-server from dropping the connection.
    const heartbeat = setInterval(() => {
      void stream.writeSSE({ id: String(seq), event: "ping", data: "" });
    }, 25000);

    const cleanup = () => {
      clearInterval(heartbeat);
      eventBus.offEvent("threads:metadataUpdated", onMeta);
      eventBus.offEvent("threads:suggestionsUpdated", onSugg);
      eventBus.offEvent("app:message", onMsg);
      eventBus.offEvent("splitview:activate", onSplit);
      eventBus.offEvent("threads:listChanged", onListChanged);
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
