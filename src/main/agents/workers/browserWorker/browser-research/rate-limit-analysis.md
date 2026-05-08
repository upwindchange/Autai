# Rate Limit Analysis

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

1. Now make a plan to add a new settings page for AI Agents, in this setting page, right now, put one dropdown menu to control how many parallel agents are allowed to run simutanously. The toggle name can be simple, there can be a question mark symbol icon with hovered tip explaining what does these two items do.
2. Store this value in backend settings db using a new key, default to two.
3. Use this number in the search query agent and extracting result agent.
4. write a new function to help batching the requests. The new function should accept numbr of parallel agents and a call back function to handle the real business logic. It returns/yields/update the finished requests index so that frontend can update status accordingly.
5. status should be updated accordingly: no racing on each other. if some agent errors out, the status of that specific agent task should be cancel instead of completed. inital status should be pending instead of processing. pending, processing, cancel and completed should all be updated correctly.
