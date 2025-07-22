import type { AppState, StateChangeEvent } from "../../electron/shared/types";
import type { IpcRendererEvent } from "electron";

interface IpcHandlers {
  syncState: (state: AppState) => void;
  handleStateChange: (event: StateChangeEvent) => void;
}

// Queue for early IPC messages that arrive before store is ready
const earlyMessageQueue: {
  type: "sync" | "change";
  payload: AppState | StateChangeEvent;
}[] = [];

// Flag to track if store is ready
let storeReady = false;
let storeHandlers: IpcHandlers | null = null;

// Store listener references for cleanup
const listeners = {
  stateSync: (_event: IpcRendererEvent, state: AppState) => {
    if (!storeReady || !storeHandlers) {
      // Store not ready yet, queue the message
      earlyMessageQueue.push({ type: "sync", payload: state });
    } else {
      storeHandlers.syncState(state);
    }
  },
  stateChange: (_event: IpcRendererEvent, event: StateChangeEvent) => {
    if (!storeReady || !storeHandlers) {
      // Store not ready yet, queue the message
      earlyMessageQueue.push({ type: "change", payload: event });
    } else {
      storeHandlers.handleStateChange(event);
    }
  }
};

// Set up IPC listeners before store creation to catch early messages
export function setupIpcListeners() {
  window.ipcRenderer.on("state:sync", listeners.stateSync);
  window.ipcRenderer.on("state:change", listeners.stateChange);
}

// Call this after store is created to process queued messages
export function processQueuedMessages(handlers: IpcHandlers) {
  storeHandlers = handlers;
  storeReady = true;

  // Process any queued messages that arrived before store was ready
  if (earlyMessageQueue.length > 0) {
    console.log(`Processing ${earlyMessageQueue.length} early state messages`);
    earlyMessageQueue.forEach((message) => {
      if (message.type === "sync") {
        handlers.syncState(message.payload as AppState);
      } else if (message.type === "change") {
        handlers.handleStateChange(message.payload as StateChangeEvent);
      }
    });
    // Clear the queue
    earlyMessageQueue.length = 0;
  }
}

// Clean up listeners
export function cleanupIpcListeners() {
  window.ipcRenderer.off("state:sync", listeners.stateSync);
  window.ipcRenderer.off("state:change", listeners.stateChange);
}
