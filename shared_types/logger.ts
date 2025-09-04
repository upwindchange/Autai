export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  VERBOSE = 'verbose',
  DEBUG = 'debug',
  SILLY = 'silly'
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  module?: string;
  metadata?: Record<string, unknown>;
}

export interface LoggerConfig {
  level?: LogLevel;
  maxFileSize?: number;
  maxFiles?: number;
  fileFormat?: 'json' | 'text';
  consoleFormat?: 'simple' | 'detailed';
}

export type LogMethod = (message: string, ...args: unknown[]) => void;

export interface Logger {
  error: LogMethod;
  warn: LogMethod;
  info: LogMethod;
  verbose: LogMethod;
  debug: LogMethod;
  silly: LogMethod;
  scope: (name: string) => Logger;
}