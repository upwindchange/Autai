import { getApiBase } from "@/lib/api";
import {
  SERVER_EVENT_NAMES,
  type ServerEventName,
  type ServerEvents,
} from "@shared/events";
import log from "electron-log/renderer";

const logger = log.scope("ServerEvents");

type AnyHandler = (payload: unknown) => void;

/**
 * App-wide manager for the server-initiated push stream (GET /events).
 *
 * Holds a single EventSource and dispatches named events to all subscribers
 * (the backend pushes via SSE).
 *
 * Register handlers with `on()` at any time (before or after connect). Open
 * the connection with `connect()` once the API base URL is known (after
 * `initApiBase()`). On automatic EventSource reconnect, handlers registered
 * via `onReconnect()` fire so callers can refetch current state.
 */
class ServerEventManager {
  private es: EventSource | null = null;
  private listeners = new Map<ServerEventName, Set<AnyHandler>>();
  private reconnectHandlers = new Set<AnyHandler>();
  private opened = false;

  /** Register a handler for a server event. Returns a disposer. */
  on<K extends ServerEventName>(
    name: K,
    handler: (payload: ServerEvents[K]) => void,
  ): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    const wrapped = handler as AnyHandler;
    set.add(wrapped);
    return () => {
      set?.delete(wrapped);
    };
  }

  /** Register a handler fired after an automatic SSE reconnect (refetch state). */
  onReconnect(handler: () => void): () => void {
    const wrapped = handler as AnyHandler;
    this.reconnectHandlers.add(wrapped);
    return () => {
      this.reconnectHandlers.delete(wrapped);
    };
  }

  /** Open the EventSource. Call after `initApiBase()` has resolved. */
  connect(): void {
    if (this.es) return;
    const es = new EventSource(`${getApiBase()}/events`);
    this.es = es;

    es.addEventListener("open", () => {
      if (this.opened) {
        logger.debug("SSE reconnected — notifying refetch handlers");
        this.reconnectHandlers.forEach((h) => h());
      }
      this.opened = true;
    });
    es.addEventListener("error", () => {
      // EventSource auto-reconnects; nothing to do here.
      logger.debug("SSE connection error (will auto-reconnect)");
    });

    // Attach a dispatcher for every known event name; subscribers are read
    // dynamically at fire time, so late `on()` calls still receive events.
    SERVER_EVENT_NAMES.forEach((name) => {
      es.addEventListener(name, (e) => {
        const set = this.listeners.get(name);
        if (!set || set.size === 0) return;
        let payload: unknown = null;
        try {
          const raw = (e as MessageEvent).data;
          payload = raw === "" || raw == null ? null : JSON.parse(raw);
        } catch (err) {
          logger.warn("malformed SSE frame", { name, err });
          return;
        }
        set.forEach((fn) => fn(payload));
      });
    });
  }
}

export const serverEvents = new ServerEventManager();
