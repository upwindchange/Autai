/**
 * PURE helpers for the chaptered internet fetch — no electron, no services,
 * no logging. Only zod + `@shared` imports so this module stays loadable
 * under vitest (which has just the `@shared` alias — see vitest.config.ts).
 *
 * Everything here is deterministic code the orchestrator runs BEFORE/AROUND
 * the LLM agents: the search query, the code-level wall pre-probe, the
 * blocked-host filter, and the landing-recovery retry prompt.
 */

/**
 * Compound wall-marker phrases a deterministic DOM-text probe treats as a
 * hard wall. Bare "VIP"/"订阅" alone is NOT a marker (prose false positives:
 * a novel can legitimately contain "VIP lounge" in its sentences); the LLM
 * agents catch bare-badge cases via reportWall with full visual judgment.
 */
export const WALL_MARKER_RE =
  /(VIP章节|VIP作品|VIP免费|开通会员|会员专享|会员订阅|付费阅读|付费章节|购买本章|订阅本书|订阅后阅读|登录后阅读|登录后继续|请登录|人机验证|滑动验证|verify you are human|recaptcha|captcha|subscribe to read|members only|age verification|年龄确认)/i;

/**
 * Returns the matched marker phrase, or null when the text carries no wall
 * marker. Used as a cost-saving pre-filter after deterministic navigations:
 * a hit blacklists + rotates the site without spending an agent call.
 */
export function probeWallMarkers(text: string): string | null {
  const match = text.match(WALL_MARKER_RE);
  return match ? match[0] : null;
}

/**
 * The single deterministic search query for a novel: title + author joined
 * with one space (both trimmed; empty parts dropped). Empty title → ""
 * (the caller marks the chapter error — nothing searchable).
 */
export function buildSearchQuery(novel: {
  title: string;
  author?: string;
}): string {
  return [novel.title, novel.author]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Drop URLs whose hostname is blocklisted, then dedupe by
 * origin+pathname+search (the same key rule `deduplicateResults` in
 * browser-research/search-agent.ts uses — wrapper URLs keep their distinct
 * destination in the query string). Invalid URL entries are skipped, never
 * thrown. Order is preserved (results arrive relevance-ranked).
 */
export function filterBlockedHosts(
  urls: string[],
  blocked: Record<string, string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.hostname in blocked) continue;
    const key = parsed.origin + parsed.pathname + parsed.search;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/** What the targetChapterAgent needs to retry a wrong landing by ORDER. */
export interface LandingRecoveryInput {
  target: number;
  lastTitle: string | null;
  lastUrl: string;
  attempt: number;
}

/**
 * The retry user-message for a target-chapter landing that opened the WRONG
 * chapter: re-open the toc, find the landed page's entry, open the entry
 * IMMEDIATELY FOLLOWING it (list order over site numerals), never re-accept
 * a page already visited.
 */
export function buildLandingRecoveryPrompt(
  input: LandingRecoveryInput,
): string {
  const lastTitle = input.lastTitle ?? "an unnamed page";
  return `Your previous attempt FAILED. Attempt ${input.attempt}: you landed on "${lastTitle}" (${input.lastUrl}), which is NOT our target — chapter ${input.target} of this book.

Rules for this retry:
- Do NOT accept "${lastTitle}" or any page you already visited. You must land on the chapter that comes AFTER it in the book's reading order.
- Re-open the book's table of contents. Find "${lastTitle}" in the chapter list, then open the entry IMMEDIATELY FOLLOWING it. Prefer list ORDER over the site's printed chapter numbers — site numbering may skip prologues/author notes and disagree with our ${input.target}.
- If the following entry is locked (VIP/付费/lock badge) or anything demands login/payment, call reportWall.
- Call reportLandedChapter ONLY when the open page is the successor of "${lastTitle}".`;
}
