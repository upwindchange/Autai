/**
 * Canonical user-interaction-blocked ("wall") detection guidance, shared by
 * every crawl agent's system prompt so wall vocabulary and bail-out behavior
 * stay identical wherever a prompt is assembled.
 *
 * Walls are interaction demands the agent cannot legitimately satisfy:
 * login walls, paywalls, captchas/human verification, age gates — plus a
 * page/TOC that never loads. They are NEVER "content missing" signals:
 * treating a wall as end-of-book or chapter-missing is the classic
 * false-finality bug this block exists to prevent.
 *
 * The block is parameterized by the agent's bail action so the same
 * definitions drive different terminals (e.g. "stop without saving").
 */

/**
 * The unified wall-detection block. A crawl agent's system prompt embeds
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
