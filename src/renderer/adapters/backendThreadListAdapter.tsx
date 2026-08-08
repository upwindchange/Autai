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
import { getApiBase } from "@/lib/api";

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
          const res = await fetch(
            `${getApiBase()}/threads/${remoteId}/messages`,
          );
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
    // This adapter serves the chat thread list only — entertainment manages its
    // own threads independently — so the mode is a fixed fact of the adapter,
    // not a parameter.
    const res = await fetch(`${getApiBase()}/threads?mode=chat`);
    const data = (await res.json()) as {
      threads: {
        id: string;
        title: string;
        status: "regular" | "archived";
        mode: "chat" | "entertainment";
        tags: TagRow[];
      }[];
    };

    // Populate tag store with thread data (thread id is the canonical key).
    const threadTags: Record<string, TagRow[]> = {};
    const threads: ThreadInfo[] = [];
    for (const t of data.threads) {
      threadTags[t.id] = t.tags;
      threads.push({
        id: t.id,
        title: t.title,
        tags: t.tags,
        status: t.status,
        mode: t.mode,
      });
    }
    useTagStore.getState().setThreadTags(threadTags, threads);

    // Fetch tag definitions alongside thread data (ensures tags are loaded on startup)
    await useTagStore.getState().fetchTags();

    // assistant-ui's RemoteThreadListAdapter speaks `remoteId`; map our `id` to
    // it here, at the aui seam. `remoteId` appears nowhere else in our code.
    return {
      threads: data.threads.map((t) => ({
        remoteId: t.id,
        title: t.title,
        status: t.status,
        tags: t.tags,
      })),
    };
  },

  async initialize(threadId: string) {
    // Chat-only adapter: new conversations are always chat threads.
    const res = await fetch(`${getApiBase()}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: threadId, mode: "chat" }),
    });
    const data = (await res.json()) as { id: string };
    // Map our backend `id` to aui's `remoteId`/`externalId` contract.
    return { remoteId: data.id, externalId: undefined };
  },

  async rename(remoteId: string, newTitle: string) {
    await fetch(`${getApiBase()}/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });
  },

  async archive(remoteId: string) {
    await fetch(`${getApiBase()}/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
  },

  async unarchive(remoteId: string) {
    await fetch(`${getApiBase()}/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "regular" }),
    });
  },

  async delete(remoteId: string) {
    await fetch(`${getApiBase()}/threads/${remoteId}`, {
      method: "DELETE",
    });
  },

  async fetch(threadId: string) {
    const res = await fetch(`${getApiBase()}/threads/${threadId}`);
    return res.json();
  },

  async generateTitle() {
    return createAssistantStream(async (controller) => {
      controller.appendText("New Chat");
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
          return aui.threadListItem.getState().remoteId;
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
