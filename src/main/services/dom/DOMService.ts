/**
 * DOM Service - Simplified implementation using Electron's debugger directly
 *
 * Phase 1 implementation that uses webContents.debugger directly with simple retry logic.
 * Eliminates unnecessary CDPService abstraction while maintaining functionality.
 */

import type { WebContents } from "electron";
import log from "electron-log/main";

import type { IDOMService, ICDPSessionManager } from "@shared/dom";
import { CDPSessionManager } from "./CDPSessionManager";

interface RetryOptions {
  attempts?: number;
  delay?: number;
  timeout?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  attempts: 3,
  delay: 1000,
  timeout: 10000,
};

export class DOMService implements IDOMService {
  private webContents: WebContents;
  private sessionManager: ICDPSessionManager;
  private isInitialized = false;
  private logger = log.scope("DOMService");

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.sessionManager = new CDPSessionManager(this);

    this.isInitialized = true;
    this.logger.info("DOMService initialized (Phase 1 - simplified)");
  }

  /**
   * Get the underlying debugger (for advanced usage)
   */
  getDebugger() {
    return this.webContents.debugger;
  }

  /**
   * Get the session manager instance
   */
  getSessionManager(): ICDPSessionManager {
    return this.sessionManager;
  }

  /**
   * Get the webContents instance
   */
  getWebContents(): WebContents {
    return this.webContents;
  }

  /**
   * Send CDP command with simple retry logic
   */
  async sendCommand<T = unknown>(
    method: string,
    params?: unknown,
    options?: RetryOptions
  ): Promise<T> {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };

    return this.executeCommandWithRetry<T>(method, opts, 1, params);
  }

  /**
   * Simple retry logic for CDP commands
   */
  private async executeCommandWithRetry<T>(
    method: string,
    options: Required<RetryOptions>,
    attempt: number = 1,
    params?: unknown
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (attempt < options.attempts) {
          const delay = options.delay * Math.pow(2, attempt - 1);
          this.logger.warn(
            `Command ${method} timed out, retrying in ${delay}ms (attempt ${
              attempt + 1
            }/${options.attempts})`
          );

          setTimeout(() => {
            this.executeCommandWithRetry<T>(
              method,
              options,
              attempt + 1,
              params
            )
              .then(resolve)
              .catch(reject);
          }, delay);
        } else {
          const error = new Error(
            `Command ${method} timed out after ${attempt} attempts`
          );
          this.logger.error(`Command ${method} failed:`, error);
          reject(error);
        }
      }, options.timeout);

      try {
        this.webContents.debugger.sendCommand(method, params);
        this.logger.debug(`Command sent: ${method}`);

        // Handle the response
        const handleResponse = (
          _event: unknown,
          responseMethod: string,
          responseParams: unknown
        ) => {
          if (responseMethod === method || responseMethod.includes("error")) {
            this.webContents.debugger.removeAllListeners("message");
            clearTimeout(timeout);

            if (responseMethod.includes("error")) {
              const error = new Error(`Command ${method} failed`);
              this.logger.error(`Command ${method} failed:`, error);
              reject(error);
            } else {
              this.logger.debug(`Command succeeded: ${method}`);
              resolve(responseParams as T);
            }
          }
        };

        this.webContents.debugger.on("message", handleResponse);
      } catch (error) {
        clearTimeout(timeout);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Failed to send command ${method}: ${errorMessage}`);
        reject(new Error(`Command send failed: ${errorMessage}`));
      }
    });
  }

  /**
   * Attach the debugger to the webContents
   */
  async attach(protocolVersion = "1.3"): Promise<void> {
    try {
      this.logger.debug(
        `Attaching debugger with protocol version: ${protocolVersion}`
      );
      this.webContents.debugger.attach(protocolVersion);
      this.logger.info("Debugger attached successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to attach debugger: ${errorMessage}`);
      throw new Error(`Debugger attach failed: ${errorMessage}`);
    }
  }

  /**
   * Detach the debugger from the webContents
   */
  async detach(): Promise<void> {
    try {
      this.logger.debug("Detaching debugger");
      this.webContents.debugger.detach();
      this.logger.info("Debugger detached successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to detach debugger: ${errorMessage}`);
      throw new Error(`Debugger detach failed: ${errorMessage}`);
    }
  }

  /**
   * Check if debugger is attached
   */
  isAttached(): boolean {
    return this.webContents.debugger.isAttached();
  }

  /**
   * Placeholder method - not implemented in Phase 1
   */
  async getDOMTree(): Promise<unknown> {
    if (!this.isInitialized) {
      throw new Error("DOMService not initialized");
    }

    // Phase 1 placeholder - this will be implemented in future phases
    throw new Error("getDOMTree() not implemented in Phase 1");
  }

  /**
   * Placeholder method - not implemented in Phase 1
   */
  async getDevicePixelRatio(): Promise<number> {
    if (!this.isInitialized) {
      throw new Error("DOMService not initialized");
    }

    // Phase 1 placeholder - this will be implemented in future phases
    throw new Error("getDevicePixelRatio() not implemented in Phase 1");
  }

  /**
   * Initialize the DOM service
   */
  async initialize(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("DOMService not properly initialized");
    }

    try {
      // Attach the debugger
      await this.attach();
      this.logger.info("DOMService initialized and debugger attached");
    } catch (error) {
      this.logger.error("Failed to initialize DOMService:", error);
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    this.logger.debug("Destroying DOMService");

    try {
      // Cleanup session manager
      await this.sessionManager.cleanup();

      // Cleanup debugger
      await this.detach();

      this.isInitialized = false;
      this.logger.info("DOMService destroyed");
    } catch (error) {
      this.logger.error("Error during DOMService destruction:", error);
    }
  }

  /**
   * Check if the service is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.isAttached();
  }

  /**
   * Get service status information
   */
  getStatus(): {
    isInitialized: boolean;
    isAttached: boolean;
    sessionCount: number;
    webContentsId: number;
  } {
    return {
      isInitialized: this.isInitialized,
      isAttached: this.isAttached(),
      sessionCount: this.sessionManager.getSessionCount(),
      webContentsId: this.webContents.id,
    };
  }
}
