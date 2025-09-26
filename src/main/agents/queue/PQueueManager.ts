import PQueue from "p-queue";
import log from "electron-log/main";

export interface PQueueManagerConfig {
  concurrency?: number;
  timeout?: number;
  autoStart?: boolean;
}

export class PQueueManager {
  private static instance: PQueueManager;
  private queue: PQueue;
  private logger = log.scope("PQueueManager");

  private constructor(config: PQueueManagerConfig = {}) {
    this.queue = new PQueue({
      concurrency: config.concurrency || 3,
      timeout: config.timeout || 30000, // 30 seconds default timeout
      autoStart: config.autoStart ?? true,
    });

    this.setupEventListeners();
    this.logger.info("PQueueManager initialized", {
      concurrency: this.queue.concurrency,
      timeout: this.queue.timeout,
    });
  }

  static getInstance(config?: PQueueManagerConfig): PQueueManager {
    if (!PQueueManager.instance) {
      PQueueManager.instance = new PQueueManager(config);
    }
    return PQueueManager.instance;
  }

  private setupEventListeners(): void {
    this.queue.on("add", () => {
      this.logger.debug("Task added to queue", {
        queueSize: this.queue.size,
        pending: this.queue.pending,
      });
    });

    this.queue.on("active", () => {
      this.logger.debug("Task started", {
        queueSize: this.queue.size,
        pending: this.queue.pending,
      });
    });

    this.queue.on("completed", (result) => {
      this.logger.debug("Task completed", {
        queueSize: this.queue.size,
        pending: this.queue.pending,
      });
    });

    this.queue.on("error", (error) => {
      this.logger.error("Task failed", {
        error: error instanceof Error ? error.message : String(error),
        queueSize: this.queue.size,
        pending: this.queue.pending,
      });
    });

    this.queue.on("idle", () => {
      this.logger.debug("Queue is idle", {
        queueSize: this.queue.size,
        pending: this.queue.pending,
      });
    });

    this.queue.on("empty", () => {
      this.logger.debug("Queue is empty", {
        queueSize: this.queue.size,
        pending: this.queue.pending,
      });
    });
  }

  async add<TaskResultType>(
    task: () => Promise<TaskResultType>,
    options?: {
      priority?: number;
      timeout?: number;
      throwOnTimeout?: boolean;
      signal?: AbortSignal;
    }
  ): Promise<TaskResultType> {
    return this.queue.add(task, options);
  }

  async addAll<TaskResultsType>(
    tasks: Array<() => Promise<TaskResultsType>>,
    options?: {
      priority?: number;
      timeout?: number;
      throwOnTimeout?: boolean;
      signal?: AbortSignal;
    }
  ): Promise<Array<TaskResultsType>> {
    return this.queue.addAll(tasks, options);
  }

  get size(): number {
    return this.queue.size;
  }

  get pending(): number {
    return this.queue.pending;
  }

  get isPaused(): boolean {
    return this.queue.isPaused;
  }

  pause(): void {
    this.queue.pause();
    this.logger.info("Queue paused");
  }

  start(): void {
    this.queue.start();
    this.logger.info("Queue started");
  }

  clear(): void {
    this.queue.clear();
    this.logger.info("Queue cleared");
  }

  async onIdle(): Promise<void> {
    return this.queue.onIdle();
  }

  async onEmpty(): Promise<void> {
    return this.queue.onEmpty();
  }

  updateConcurrency(concurrency: number): void {
    this.queue.concurrency = concurrency;
    this.logger.info("Queue concurrency updated", { concurrency });
  }

  getStatus(): {
    size: number;
    pending: number;
    concurrency: number;
    isPaused: boolean;
  } {
    return {
      size: this.size,
      pending: this.pending,
      concurrency: this.queue.concurrency,
      isPaused: this.isPaused,
    };
  }

  async shutdown(): Promise<void> {
    this.logger.info("Shutting down PQueueManager");

    // Wait for all pending tasks to complete
    if (this.size > 0 || this.pending > 0) {
      this.logger.info("Waiting for pending tasks to complete", {
        size: this.size,
        pending: this.pending,
      });
      await this.onIdle();
    }

    this.clear();
    this.logger.info("PQueueManager shutdown complete");
  }
}