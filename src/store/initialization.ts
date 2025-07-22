import type { AppState } from "../../electron/shared/types";

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

export interface InitializationState {
  isInitializing: boolean;
  initializationError: string | null;
  initializationRetryCount: number;
}

export interface InitializationHandlers {
  syncState: (state: AppState) => void;
  setState: (state: Partial<InitializationState>) => void;
}

export async function loadInitialState(
  attemptNumber: number,
  handlers: InitializationHandlers
): Promise<void> {
  try {
    handlers.setState({ isInitializing: true, initializationError: null });

    const state = await window.ipcRenderer.invoke("app:getState");

    if (state) {
      handlers.syncState(state);
      handlers.setState({
        isInitializing: false,
        initializationError: null,
        initializationRetryCount: 0,
      });
    } else {
      throw new Error("Received empty state from main process");
    }
  } catch (error) {
    console.error("Failed to get initial app state:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    if (attemptNumber < MAX_RETRY_ATTEMPTS - 1) {
      // Retry with exponential backoff
      handlers.setState({
        initializationError: `Failed to load initial state. Retrying... (${
          attemptNumber + 1
        }/${MAX_RETRY_ATTEMPTS})`,
        initializationRetryCount: attemptNumber + 1,
      });

      setTimeout(() => {
        loadInitialState(attemptNumber + 1, handlers);
      }, RETRY_DELAYS[attemptNumber] || 5000);
    } else {
      // Max retries reached
      handlers.setState({
        isInitializing: false,
        initializationError: `Failed to load application state after ${MAX_RETRY_ATTEMPTS} attempts: ${errorMessage}`,
        initializationRetryCount: MAX_RETRY_ATTEMPTS,
      });
    }
  }
}