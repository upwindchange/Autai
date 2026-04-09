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
