import PQueue from "p-queue";
import log from "electron-log/main";

const logger = log.scope("concurrentBatch");

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface BatchStatusUpdate {
  index: number;
  status: TaskStatus;
  error?: unknown;
}

/**
 * Run an array of async tasks with bounded concurrency, calling `onStatusChange`
 * each time a single task transitions state.
 *
 * - All tasks start as "pending".
 * - When a task begins executing, it becomes "in_progress".
 * - On success, "completed".
 * - On error, "cancelled".
 *
 * Returns an array of results in the same order as the input tasks.
 * Failed tasks produce a `{ status: "rejected", reason }` entry so callers
 * can distinguish success from failure.
 */
export async function concurrentBatch<T>(
  tasks: Array<{ index: number; execute: () => Promise<T> }>,
  concurrency: number,
  onStatusChange: (update: BatchStatusUpdate) => void,
): Promise<Array<PromiseSettledResult<T>>> {
  const queue = new PQueue({ concurrency, autoStart: true });

  logger.debug("Starting batch", { taskCount: tasks.length, concurrency });

  // Emit initial "pending" for all tasks
  for (const task of tasks) {
    onStatusChange({ index: task.index, status: "pending" });
  }

  const wrappedTasks = tasks.map((task) => () => {
    onStatusChange({ index: task.index, status: "in_progress" });
    return task.execute().then(
      (result) => {
        onStatusChange({ index: task.index, status: "completed" });
        return result;
      },
      (error: unknown) => {
        onStatusChange({ index: task.index, status: "cancelled", error });
        throw error;
      },
    );
  });

  const results = await Promise.allSettled(
    wrappedTasks.map((fn) => queue.add(fn)),
  );

  logger.debug("Batch complete", {
    fulfilled: results.filter((r) => r.status === "fulfilled").length,
    rejected: results.filter((r) => r.status === "rejected").length,
  });

  return results;
}
