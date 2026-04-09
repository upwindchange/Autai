import type { FC, PropsWithChildren } from "react";
import { useMemo, useState } from "react";
import {
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
  type GenericThreadHistoryAdapter,
  type MessageFormatItem,
  type MessageFormatRepository,
  type MessageFormatAdapter,
  RuntimeAdapterProvider,
  useAui,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import type { UIMessage } from "ai";
import type { TagRow } from "@shared/tag";
import { useTagStore, type ThreadInfo } from "@/stores/tagStore";

const API_BASE = "http://localhost:3001";

// ---------------------------------------------------------------------------
// Backend thread history adapter class — uses aui for thread ID resolution
// ---------------------------------------------------------------------------

class BackendThreadHistoryAdapter implements ThreadHistoryAdapter {
  constructor(private getRemoteId: () => string | null | undefined) {}

  async load() {
    // Low-level load — not used directly when withFormat is available
    return { messages: [] };
  }

  async append() {
    // No-op: backend onFinish handles persistence
  }

  withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
    formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
  ): GenericThreadHistoryAdapter<TMessage> {
    const adapter = this;
    return {
      async load(): Promise<MessageFormatRepository<TMessage>> {
        const remoteId = adapter.getRemoteId();
        if (!remoteId) return { messages: [] };

        try {
          const res = await fetch(`${API_BASE}/threads/${remoteId}/messages`);
          const { messages } = (await res.json()) as { messages: UIMessage[] };

          if (!messages || messages.length === 0) {
            return { messages: [] };
          }

          // Convert stored UIMessage[] to MessageFormatItem<TMessage>[]
          // Backend stores UIMessages as-is, so we cast through unknown
          const typed = messages as unknown as TMessage[];
          const items: MessageFormatItem<TMessage>[] = typed.map(
            (msg, idx) => ({
              parentId: idx === 0 ? null : formatAdapter.getId(typed[idx - 1]!),
              message: msg,
            }),
          );

          return { headId: null, messages: items };
        } catch {
          return { messages: [] };
        }
      },

      async append() {
        // No-op: backend onFinish handles persistence
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Thread list adapter — REST calls to Express backend
// ---------------------------------------------------------------------------

export const backendThreadListAdapter: RemoteThreadListAdapter = {
  async list() {
    const res = await fetch(`${API_BASE}/threads`);
    const data = (await res.json()) as {
      threads: {
        remoteId: string;
        title: string | null;
        status: "regular" | "archived";
        tags: TagRow[];
      }[];
    };

    // Populate tag store with thread data
    const threadTags: Record<string, TagRow[]> = {};
    const threads: ThreadInfo[] = [];
    for (const t of data.threads) {
      threadTags[t.remoteId] = t.tags;
      threads.push({
        remoteId: t.remoteId,
        title: t.title ?? undefined,
        tags: t.tags,
      });
    }
    useTagStore.getState().setThreadTags(threadTags, threads);

    return {
      threads: data.threads.map((t) => ({
        remoteId: t.remoteId,
        title: t.title ?? undefined,
        status: t.status,
        tags: t.tags,
      })),
    };
  },

  async initialize(threadId: string) {
    const res = await fetch(`${API_BASE}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: threadId }),
    });
    return res.json();
  },

  async rename(remoteId: string, newTitle: string) {
    await fetch(`${API_BASE}/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });
  },

  async archive(remoteId: string) {
    await fetch(`${API_BASE}/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
  },

  async unarchive(remoteId: string) {
    await fetch(`${API_BASE}/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "regular" }),
    });
  },

  async delete(remoteId: string) {
    await fetch(`${API_BASE}/threads/${remoteId}`, {
      method: "DELETE",
    });
  },

  async fetch(threadId: string) {
    const res = await fetch(`${API_BASE}/threads/${threadId}`);
    return res.json();
  },

  async generateTitle(
    remoteId: string,
    messages: readonly {
      role: string;
      content: readonly { type: string; text?: string }[];
    }[],
  ) {
    return createAssistantStream(async (controller) => {
      const firstUserMessage = messages.find((m) => m.role === "user");
      let title = "New Chat";
      if (firstUserMessage) {
        const content = firstUserMessage.content
          .filter((c) => c.type === "text" && c.text)
          .map((c) => c.text!)
          .join(" ");
        title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
      }
      controller.appendText(title);

      // Persist title to backend so it survives app reboot
      if (remoteId) {
        fetch(`${API_BASE}/threads/${remoteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }).catch(() => {});
      }
    });
  },

  // unstable_Provider is assigned after definition below
  unstable_Provider: undefined as unknown as FC<PropsWithChildren>,
};

// ---------------------------------------------------------------------------
// unstable_Provider — wraps inner runtime with history adapter
// ---------------------------------------------------------------------------

const BackendThreadListProvider: FC<PropsWithChildren> = ({ children }) => {
  const aui = useAui();

  const [history] = useState(
    () =>
      new BackendThreadHistoryAdapter(() => {
        try {
          return aui.threadListItem().getState().remoteId;
        } catch {
          return null;
        }
      }),
  );

  const adapters = useMemo(() => ({ history }), [history]);

  return (
    <RuntimeAdapterProvider adapters={adapters}>
      {children}
    </RuntimeAdapterProvider>
  );
};

// Assign the provider to the adapter
backendThreadListAdapter.unstable_Provider = BackendThreadListProvider;
