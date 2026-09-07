/**
 * Search entry for the chaptered internet fetch: locate the reading site for
 * a novel via the browserWorker search pipeline (`executeSearchQueries`) and
 * return relevance-ranked, blocked-host-filtered candidate URLs.
 *
 * Deterministic BY DESIGN: the query string is built by code
 * (`buildSearchQuery`), never by an LLM — the user's spec pins this so the
 * search cannot be creatively rewritten away from the book's identity.
 */

import log from "electron-log/main";
import type { InternetNovel } from "@shared";
import { SessionTabService } from "@/services";
import { entertainmentBackendService } from "@/services";
import { executeSearchQueries } from "@agents/workers/browserWorker/browser-research/search-agent";
import type { ResearchPlan } from "@agents/workers/browserWorker/browser-research/planner";
import { buildSearchQuery, filterBlockedHosts } from "./pure";

const logger = log.scope("Dehydrate:InternetFetch");

/**
 * Book-scoped RAM cache of search results, keyed by threadId: avoids
 * re-paying the LLM search analysis when the orchestrator rotates hosts
 * within one book. Cleared at book end (`clearSearchCache`).
 */
const searchCache = new Map<string, { query: string; urls: string[] }>();

/** Drop the thread's cached search results (called at book end). */
export function clearSearchCache(threadId: string): void {
  searchCache.delete(threadId);
}

/**
 * Run the book search once per book: build the deterministic query, run it
 * through `executeSearchQueries` in a dedicated search session, filter out
 * blocklisted hosts, cache, and return the candidate URLs in relevance
 * order. Returns `[]` when there is nothing searchable (empty title), the
 * engine yields nothing even after one retry, or the call is aborted.
 */
export async function runBookSearch(
  novel: InternetNovel,
  threadId: string,
  crawlSessionId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const query = buildSearchQuery(novel);
  if (!query) return [];

  const cached = searchCache.get(threadId);
  if (cached && cached.query === query) return cached.urls;

  const searchSessionId = `ent-search-${threadId}`;
  const sts = SessionTabService.getInstance();
  // Must activate the search session BEFORE executeSearchQueries — the
  // SessionTabService only tracks tabs of activated sessions.
  await sts.activateSession(searchSessionId);

  const focus = `A book page or table-of-contents page of the web novel "${novel.title}"${novel.author ? ` by ${novel.author}` : ""} on a novel-reading site — not app-download pages, not aggregators`;
  const plan: ResearchPlan = {
    id: searchSessionId,
    title: novel.title,
    description: `Locate the reading site for the novel "${novel.title}"`,
    queries: [{ id: "q0", query, focus }],
  };

  // The writer arg streams plan-card UI in browser-research; entertainment
  // has no plan-card surface, so it is a no-op.
  let results = await executeSearchQueries(
    plan,
    searchSessionId,
    "",
    { write() {} } as never,
    `ent-search-plan-${threadId}`,
    signal,
  );
  if (results.length === 0 && !signal?.aborted) {
    // Empty results may be a walled engine results page — retry the whole
    // call ONCE (never rotate engines).
    logger.info("search returned nothing — retrying once", { threadId, query });
    results = await executeSearchQueries(
      plan,
      searchSessionId,
      "",
      { write() {} } as never,
      `ent-search-plan-${threadId}`,
      signal,
    );
  }

  // Hand the crawl tab back its session before returning.
  await sts.activateSession(crawlSessionId);

  const urls = filterBlockedHosts(
    results.map((r) => r.url),
    entertainmentBackendService.getBlockedSites(threadId),
  );
  if (urls.length > 0) {
    searchCache.set(threadId, { query, urls });
  }
  return urls;
}
