# Rate Limit Analysis

## Error Types

Errors like "Failed after 3 attempts" and "The service may be temporarily overloaded" come from the AI SDK's `RetryError` wrapping an underlying `APICallError`. The SDK auto-retries with exponential backoff (default 2 retries, respects `retry-after` headers). Configurable via `maxRetries` in `streamText` calls.

Key error types to catch:
- `APICallError` — rate limits, overloaded errors (has `statusCode`, `isRetryable`)
- `RetryError` — final failure after retries exhausted (has `lastError`, `errors` array)

## Sending Errors to Frontend

Two existing mechanisms:

1. **Writer stream** (`UIMessageStreamWriter`) — write error text inline in the chat via `writer.write()` inside the catch blocks of `executeSingleSearchQuery` and `executeSingleExtraction`.
2. **`sendAlert()` via IPC** (`src/main/utils/messageUtils.ts`) — sends persistent dismissible toast notifications via `mainWindow.webContents.send("app:message", ...)`.

Where to add error handling:
- `search-agent.ts:339-345` (catch block in executeSingleSearchQuery)
- `result-extractor.ts:218-233` (catch block in executeSingleExtraction)

## Parallel Processing Hotspots

No concurrency limiting exists anywhere in the pipeline (no p-queue, semaphore, etc.).

### Search Stage

`search-agent.ts:399` — `Promise.allSettled` runs up to 5 queries fully in parallel.

Each query pipeline:
1. 1 `streamText` call (DOM analysis)
2. Up to 5 results × 3-tier tool calls (`getAttribute` → `getAllAttributes` → `interceptClickUrl`) in `resolveSearchResultUrls` (line 225)

Worst case: **5 concurrent `streamText` + 15 concurrent tool API calls**

### Extraction Stage

`result-extractor.ts:288` — `Promise.allSettled` runs up to 8 extractions fully in parallel.

Each extraction: 1 `streamText` call.

Worst case: **8 concurrent `streamText` calls**

### Planner

`planner.ts:43` — `.max(5)` queries per research plan.

### Stage Sequencing

Stages run sequentially (planner → search → extraction → summary), so the peak concurrency is within each stage, not across stages.

## Summary

The search stage is the biggest concern: 5 parallel `streamText` calls hitting the model API simultaneously, followed immediately by up to 15 tool calls for URL resolution. The extraction stage adds another 8 concurrent `streamText` calls. No throttling or concurrency control exists at any level.
