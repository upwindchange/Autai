import { EventEmitter } from "node:events";
import type { ServerEventName, ServerEvents } from "@shared/events";

/**
 * Transport-agnostic event bus for main-process, server-initiated pushes.
 *
 * Services that previously called `webContents.send(...)` now emit here. The
 * `GET /events` SSE route subscribes and forwards to HTTP clients. During the
 * IPC migration, callers emit on the bus *and* keep the legacy
 * `webContents.send`; once the renderer subscribes over SSE, the legacy sends
 * are removed.
 */
class TypedEventBus extends EventEmitter {
  emitEvent<K extends ServerEventName>(name: K, payload: ServerEvents[K]): boolean {
    return super.emit(name, payload);
  }

  onEvent<K extends ServerEventName>(
    name: K,
    listener: (payload: ServerEvents[K]) => void,
  ): this {
    return super.on(name, listener);
  }

  offEvent<K extends ServerEventName>(
    name: K,
    listener: (payload: ServerEvents[K]) => void,
  ): this {
    return super.off(name, listener);
  }
}

export const eventBus = new TypedEventBus();
// Allow many concurrent SSE subscribers (one per window/client) without warnings.
eventBus.setMaxListeners(100);
