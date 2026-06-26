import type { TagRow, ThreadMode } from "@shared/tag";
import { getApiBase } from "@/lib/api";

export async function fetchTags(mode?: ThreadMode): Promise<TagRow[]> {
  const params = mode ? `?mode=${mode}` : "";
  const res = await fetch(`${getApiBase()}/tags${params}`);
  const data = (await res.json()) as { tags: TagRow[] };
  return data.tags;
}

export async function createTag(
  name: string,
  color: string,
  mode?: ThreadMode,
): Promise<TagRow> {
  const res = await fetch(`${getApiBase()}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color, ...(mode ? { mode } : {}) }),
  });
  const data = (await res.json()) as { tag: TagRow };
  return data.tag;
}

export async function updateTag(
  id: number,
  updates: { name?: string; color?: string },
): Promise<TagRow> {
  const res = await fetch(`${getApiBase()}/tags/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  const data = (await res.json()) as { tag: TagRow };
  return data.tag!;
}

export async function deleteTag(id: number): Promise<void> {
  await fetch(`${getApiBase()}/tags/${id}`, { method: "DELETE" });
}

export async function addTagToThread(
  threadId: string,
  tagId: number,
): Promise<void> {
  await fetch(`${getApiBase()}/threads/${threadId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tagId }),
  });
}

export async function removeTagFromThread(
  threadId: string,
  tagId: number,
): Promise<void> {
  await fetch(`${getApiBase()}/threads/${threadId}/tags/${tagId}`, {
    method: "DELETE",
  });
}

export async function renameThread(
  threadId: string,
  title: string,
): Promise<void> {
  await fetch(`${getApiBase()}/threads/${threadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

/**
 * Set or clear a thread's per-thread chat model override.
 * Pass null providerId/modelId to revert to the global default.
 */
export async function setThreadChatOverride(
  threadId: string,
  override: { providerId: string | null; modelId: string | null },
): Promise<void> {
  await fetch(`${getApiBase()}/threads/${threadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatOverride: override }),
  });
}

export async function deleteAllThreads(
  status?: "regular" | "archived",
): Promise<void> {
  await fetch(`${getApiBase()}/threads/bulk`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function archiveAllThreads(): Promise<void> {
  await fetch(`${getApiBase()}/threads/archive-all`, { method: "POST" });
}

export async function bulkUpdateThreadStatus(
  threadIds: string[],
  status: "regular" | "archived",
): Promise<void> {
  await fetch(`${getApiBase()}/threads/bulk-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadIds, status }),
  });
}

export async function bulkDeleteThreadsByIds(
  threadIds: string[],
): Promise<void> {
  await fetch(`${getApiBase()}/threads/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadIds }),
  });
}

export async function searchThreads(
  query: string,
  mode?: ThreadMode,
): Promise<{
  threads: {
    remoteId: string;
    title: string;
    status: "regular" | "archived";
    mode: ThreadMode;
    tags: TagRow[];
  }[];
}> {
  const params = new URLSearchParams({ q: query });
  if (mode) params.set("mode", mode);
  const res = await fetch(
    `${getApiBase()}/threads/search?${params.toString()}`,
  );
  return (await res.json()) as {
    threads: {
      remoteId: string;
      title: string;
      status: "regular" | "archived";
      mode: ThreadMode;
      tags: TagRow[];
    }[];
  };
}
