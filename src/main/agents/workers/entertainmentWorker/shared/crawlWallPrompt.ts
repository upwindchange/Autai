/**
 * Canonical user-interaction-blocked ("wall") detection guidance, shared by
 * EVERY crawl agent (judge / advance / TOC / extract) so wall vocabulary and
 * bail-out behavior stay identical wherever a system prompt is assembled.
 *
 * Walls are interaction demands the agent cannot legitimately satisfy:
 * login walls, paywalls, captchas/human verification, age gates — plus a
 * page/TOC that never loads. They are NEVER "content missing" signals:
 * treating a wall as end-of-book or chapter-missing is the classic
 * false-finality bug this block exists to prevent.
 *
 * The block is parameterized by the agent's bail action so the same
 * definitions drive different terminals:
 *   - judge   → rejectCandidate (orchestrator tries the next candidate URL)
 *   - advance → siteBlocked (site marked dead → re-search a different site)
 *   - TOC     → siteBlocked
 *   - extract → no bail tool; stop WITHOUT saving (a truncated save would
 *               commit a partial chapter/page as fetched)
 *
 * Only strings live here. Tool objects stay in their consumer module —
 * `tool()`'s inferred type references `@ai-sdk/provider` internals and is
 * not portable across module boundaries. Consumers build their terminal
 * with `SITE_BLOCKED_TOOL_DESCRIPTION` / `REJECT_WALL_DESCRIPTION`.
 */

/** Shared description for the `siteBlocked` tool — the canonical bail. */
export const SITE_BLOCKED_TOOL_DESCRIPTION =
  "Call this when you cannot proceed on this site because of a user-interaction wall: login wall, paywall (付费 / VIP / 登录后阅读), captcha/human verification (人机验证 / 滑动验证), age gate, or the page/TOC never loads.";

/** Shared wall list for the judge's rejectCandidate description. */
export const REJECT_WALL_DESCRIPTION =
  "login wall, paywall, captcha/human verification, age gate";

/**
 * The unified wall-detection block. Every crawl agent's system prompt embeds
 * this verbatim; only the prescribed action differs.
 */
export function buildUserInteractionWallBlock(action: string): string {
  return `USER-INTERACTION WALLS — detect and stop:
A "wall" is any page state that demands interaction you cannot legitimately perform:
- Login walls: 登录后阅读 / sign in to continue / 403 with a login form.
- Paywalls: 付费 / VIP / 订阅 / subscribe to read / "members only" content.
- Captchas & human verification: 人机验证 / 滑动验证 / recaptcha / "verify you are human".
- Age gates: 年龄确认 / age verification / "are you over 18".
Also treat a page or TOC that never loads (endless spinner, blank render, connection reset) as a wall.
A wall is NEVER "content missing" — do not interpret it as end-of-book, a missing chapter, or the end of a post when it is the ONLY thing preventing you from reading content you already located.

When you hit a wall: stop immediately, do not click anything to dismiss or bypass it, and ${action}.`;
}

/**
 * Marker substrings for the digest-based wall heuristic (judge only).
 * Hints, not proof — several also appear as page chrome on readable pages;
 * the digest prompt presents them exactly that way.
 */
export const WALL_MARKER_PATTERNS: readonly string[] = [
  "登录后阅读",
  "付费",
  "VIP",
  "订阅",
  "开通会员",
  "人机验证",
  "滑动验证",
  "年龄确认",
  "captcha",
  "verify you are human",
  "sign in to continue",
  "subscribe to read",
];
