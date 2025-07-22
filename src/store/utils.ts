import type { Task } from "../../electron/shared/types";

// Helper to convert plain objects back to Maps
export function objectToMap<T>(
  obj: Record<string, T> | undefined | null
): Map<string, T> {
  const map = new Map<string, T>();
  if (obj && typeof obj === "object") {
    Object.entries(obj).forEach(([key, value]) => {
      map.set(key, value);
    });
  }
  return map;
}

// Helper to restore page Maps in tasks
export function restoreTaskPages(task: Task): Task {
  return {
    ...task,
    pages:
      task.pages instanceof Map
        ? task.pages
        : objectToMap(
            task.pages as Record<
              string,
              import("../../electron/shared/types").Page
            >
          ),
  };
}