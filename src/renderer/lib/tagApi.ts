import type { TagRow } from "@shared/tag";

const API_BASE = "http://localhost:3001";

export async function fetchTags(): Promise<TagRow[]> {
  const res = await fetch(`${API_BASE}/tags`);
  const data = (await res.json()) as { tags: TagRow[] };
  return data.tags;
}

export async function createTag(name: string): Promise<TagRow> {
  const res = await fetch(`${API_BASE}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = (await res.json()) as { tag: TagRow };
  return data.tag;
}

export async function renameTag(id: number, name: string): Promise<void> {
  await fetch(`${API_BASE}/tags/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function deleteTag(id: number): Promise<void> {
  await fetch(`${API_BASE}/tags/${id}`, { method: "DELETE" });
}

export async function addTagToThread(
  threadId: string,
  tagId: number,
): Promise<void> {
  await fetch(`${API_BASE}/threads/${threadId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tagId }),
  });
}

export async function removeTagFromThread(
  threadId: string,
  tagId: number,
): Promise<void> {
  await fetch(`${API_BASE}/threads/${threadId}/tags/${tagId}`, {
    method: "DELETE",
  });
}

export async function renameThread(
  threadId: string,
  title: string,
): Promise<void> {
  await fetch(`${API_BASE}/threads/${threadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function deleteAllThreads(
  status?: "regular" | "archived",
): Promise<void> {
  await fetch(`${API_BASE}/threads/bulk`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function archiveAllThreads(): Promise<void> {
  await fetch(`${API_BASE}/threads/archive-all`, { method: "POST" });
}

export async function bulkUpdateThreadStatus(
  threadIds: string[],
  status: "regular" | "archived",
): Promise<void> {
  await fetch(`${API_BASE}/threads/bulk-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadIds, status }),
  });
}

export async function bulkDeleteThreadsByIds(
  threadIds: string[],
): Promise<void> {
  await fetch(`${API_BASE}/threads/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadIds }),
  });
}

export async function searchThreads(
  query: string,
): Promise<{
  threads: {
    remoteId: string;
    title: string;
    status: "regular" | "archived";
    tags: TagRow[];
  }[];
}> {
  const res = await fetch(
    `${API_BASE}/threads/search?q=${encodeURIComponent(query)}`,
  );
  return (await res.json()) as {
    threads: {
      remoteId: string;
      title: string;
      status: "regular" | "archived";
      tags: TagRow[];
    }[];
  };
}
