# Source Parts Injection: Approach Comparison

## Background

The `Sources` component (`src/renderer/components/assistant-ui/sources.tsx`) renders URL citations as small badges with favicons. It is triggered by `SourceMessagePart` — a first-class message part type in assistant-ui:

```typescript
type SourceMessagePart = {
  readonly type: "source";
  readonly sourceType: "url";
  readonly id: string;
  readonly url: string;
  readonly title?: string;
  readonly parentId?: string;
};
```

The rendering is wired up in `thread.tsx` at the `case "source"` branch, but no backend code currently produces source parts. Two approaches to populate them:

---

## Approach 1: Backend Streaming Injection

Inject source parts in the agent workers during streaming using the AI SDK's built-in `source-url` stream event.

**Where**: In `browser-research/worker.ts` or `chatWorker.ts`, after search/extraction stages.

```typescript
writer.write({
  type: "source-url",
  sourceId: "src-1",
  url: "https://example.com",
  title: "Example Source",
});
```

### Pros

- **Native pipeline** — `source-url` is a first-class AI SDK stream event. `AssistantChatTransport` already parses it into `SourceMessagePart` automatically. No frontend changes needed.
- **Single source of truth** — the backend decides what counts as a source. No risk of frontend/backend disagreeing on what to cite.
- **Works with persistence** — source parts are part of the UIMessage stored by `onFinish`, so they survive reloads and thread history.
- **Streaming** — sources appear in real-time as the agent discovers them, not after the entire response completes.

### Cons

- **Harder to test** — must run the full agent pipeline to verify source rendering.
- **Tied to worker architecture** — each worker (chat, browser-research, etc.) needs its own source injection logic. If you add a new worker, you must remember to add it there too.
- **Less flexible post-hoc** — once streamed and persisted, source parts can't easily be retroactively added to an existing message.

---

## Approach 2: Frontend Runtime Adapter Transformation

Transform messages in the adapter layer — parse tool results or text content after receiving from backend, extract URLs, and inject source parts into the message content array.

**Where**: In `backendThreadListAdapter.tsx`, inside the `load()` method, or via a custom `MessageFormatAdapter`.

```typescript
const enriched = messages.map((msg) => ({
  ...msg,
  parts: [...(msg.parts || []), ...extractSourceParts(msg)],
}));
```

### Pros

- **Backend-agnostic** — works regardless of which worker or provider generated the message. One transformation handles all cases.
- **Easy to test** — pure function: UIMessage in, enriched UIMessage out. Can unit test without running agents.
- **Can enrich historical messages** — can add source parts to old messages on load, even if the backend didn't emit them at the time.
- **Single place** — one transformation point, regardless of how many backend workers exist.

### Cons

- **No streaming** — transformation happens at load time (for history) or would require intercepting the stream (complex). Sources only appear after the full message is received, not during streaming.
- **Fragile parsing** — you're reverse-engineering source URLs from tool call args or text content. If the agent changes how it formats citations, the extraction breaks silently.
- **Persistence mismatch** — if you transform on the frontend but the backend stores the original UIMessage, you'd need to re-transform on every load. If you write transformed messages back, you'd need to modify the persistence flow.
- **Two sources of truth** — the backend owns the message content, but the frontend is second-guessing and augmenting it. This can lead to duplicated or conflicting source entries.

---

## Comparison

|                        | Backend Injection       | Frontend Adapter        |
| ---------------------- | ----------------------- | ----------------------- |
| Streaming support      | Yes                     | No (or very complex)    |
| Persistence            | Automatic               | Mismatch risk           |
| Backend-agnostic       | No (per-worker)         | Yes                     |
| Testability            | Requires full pipeline  | Pure function           |
| Historical enrichment  | No                      | Yes                     |
| Fragility              | Low (explicit data)     | High (parsing text/args)|

---

## Recommendation

Go with **backend injection**. The AI SDK already has `source-url` as a native stream event type, the rendering is wired up, and the persistence story is clean. The per-worker concern is manageable since source injection is only needed in the research/browser worker where sources are actually discovered.
