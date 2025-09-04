import log from 'electron-log/main';
import { app } from 'electron';
import path from 'path';
import type { LogLevel, Logger, LoggerConfig } from '@shared/index';

class LoggerService {
  private static instance: LoggerService | null = null;
  private initialized = false;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService();
    }
    return LoggerService.instance;
  }

  initialize(config?: LoggerConfig): void {
    if (this.initialized) {
      return;
    }

    // Configure log file path
    const userDataPath = app.getPath('userData');
    const logPath = path.join(userDataPath, 'logs');
    
    // Set log file path with date-based filename for production
    log.transports.file.resolvePathFn = () => {
      const date = new Date().toISOString().split('T')[0];
      const filename = app.isPackaged ? `main-${date}.log` : 'main.log';
      return path.join(logPath, filename);
    };
    
    // Configure file transport
    log.transports.file.level = config?.level || (app.isPackaged ? 'info' : 'debug');
    log.transports.file.maxSize = config?.maxFileSize || 10 * 1024 * 1024; // 10MB default
    log.transports.file.format = config?.fileFormat === 'json' 
      ? '{h}:{i}:{s}:{ms} {json}' 
      : '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
    
    // Enable file rotation in production
    if (app.isPackaged) {
      log.transports.file.archiveLog = (file) => {
        // Archive old logs with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const newName = file.path.replace('.log', `-${timestamp}.log`);
        return newName;
      };
    }

    // Configure console transport
    log.transports.console.level = app.isPackaged ? 'warn' : 'debug';
    
    // Set format for console
    if (config?.consoleFormat === 'detailed') {
      log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{processType}] [{level}] {text}';
    }

    // Enable IPC transport for renderer process logs
    log.transports.ipc.level = 'debug';

    // Catch errors
    log.errorHandler.startCatching({
      showDialog: false,
      onError: (error) => {
        log.error('Uncaught error:', error);
      }
    });

    // Log initialization
    log.info('Logger service initialized', {
      logPath,
      fileLevel: log.transports.file.level,
      consoleLevel: log.transports.console.level,
      isPackaged: app.isPackaged
    });

    this.initialized = true;
  }

  createLogger(scope: string): Logger {
    const scopedLog = log.scope(scope);
    
    return {
      error: (message: string, ...args: unknown[]) => scopedLog.error(message, ...args),
      warn: (message: string, ...args: unknown[]) => scopedLog.warn(message, ...args),
      info: (message: string, ...args: unknown[]) => scopedLog.info(message, ...args),
      verbose: (message: string, ...args: unknown[]) => scopedLog.verbose(message, ...args),
      debug: (message: string, ...args: unknown[]) => scopedLog.debug(message, ...args),
      silly: (message: string, ...args: unknown[]) => scopedLog.silly(message, ...args),
      scope: (name: string) => this.createLogger(`${scope}:${name}`)
    };
  }

  setLevel(level: LogLevel): void {
    log.transports.file.level = level;
    log.transports.console.level = level;
    log.info(`Log level changed to: ${level}`);
  }

  getLogPath(): string {
    return log.transports.file.getFile()?.path || '';
  }

  clearLogs(): void {
    try {
      const file = log.transports.file.getFile();
      if (file) {
        file.clear();
        log.info('Log file cleared');
      }
    } catch (error) {
      log.error('Failed to clear logs:', error);
    }
  }
}

// Export singleton instance
export const loggerService = LoggerService.getInstance();

// Export convenience function for creating loggers
export function createLogger(scope: string): Logger {
  return loggerService.createLogger(scope);
}