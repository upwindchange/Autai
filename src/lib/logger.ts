import log from 'electron-log/renderer';
import type { Logger, LogLevel } from '@shared/index';

class RendererLogger {
  private static instance: RendererLogger | null = null;

  private constructor() {
    // Configure renderer logger
    log.transports.console.level = 'debug';
    log.transports.ipc.level = 'debug'; // Send logs to main process
  }

  static getInstance(): RendererLogger {
    if (!RendererLogger.instance) {
      RendererLogger.instance = new RendererLogger();
    }
    return RendererLogger.instance;
  }

  createLogger(scope: string): Logger {
    const scopedLog = log.scope(scope);
    
    return {
      error: (message: string, ...args: unknown[]) => {
        scopedLog.error(message, ...args);
      },
      warn: (message: string, ...args: unknown[]) => {
        scopedLog.warn(message, ...args);
      },
      info: (message: string, ...args: unknown[]) => {
        scopedLog.info(message, ...args);
      },
      verbose: (message: string, ...args: unknown[]) => {
        scopedLog.verbose(message, ...args);
      },
      debug: (message: string, ...args: unknown[]) => {
        scopedLog.debug(message, ...args);
      },
      silly: (message: string, ...args: unknown[]) => {
        scopedLog.silly(message, ...args);
      },
      scope: (name: string) => this.createLogger(`${scope}:${name}`)
    };
  }

  setLevel(level: LogLevel): void {
    log.transports.console.level = level;
    log.transports.ipc.level = level;
  }
}

// Export singleton instance
export const rendererLogger = RendererLogger.getInstance();

// Export convenience function
export function createLogger(scope: string): Logger {
  return rendererLogger.createLogger(scope);
}

// Export default logger for convenience
export const logger = createLogger('renderer');