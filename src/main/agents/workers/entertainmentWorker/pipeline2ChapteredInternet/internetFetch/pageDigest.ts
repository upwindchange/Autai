/**
 * Cheap page digest for the search-path judge (phase 1).
 *
 * The DOM-tree judge reads a 10–50k-token flattened DOM to answer a binary
 * question ("is this the beginning of chapter N?"). This module distills the
 * live page into a ~1.2k-char digest — title, first heading, URL, and the
 * first ~1200 chars of whitespace-normalized visible text, plus wall-marker
 * hits — collected in ONE `Runtime.evaluate` round-trip, no DOM tree build,
 * no change detection.
 */
import type { Protocol as CDP } from "devtools-protocol";
import { SessionTabService } from "@/services";
import { sendCDPCommand } from "@/services/dom/utils/DOMUtils";
import { WALL_MARKER_PATTERNS } from "../../shared/crawlWallPrompt";

export interface PageDigest {
  title: string;
  heading: string | null;
  url: string;
  /** ~1200 chars of visible body text, whitespace-normalized. */
  text: string;
  /** Subset of WALL_MARKER_PATTERNS found in text or title. */
  wallMarkers: string[];
}

/**
 * Collect a digest of the page currently loaded in the tab. Throws when the
 * tab is gone/destroyed or `Runtime.evaluate` fails (detached debugger) —
 * callers treat that as a thin digest and fall back to the DOM judge.
 */
export async function getPageDigest(tabId: string): Promise<PageDigest> {
  const tab = SessionTabService.getInstance().getTab(tabId);
  if (!tab?.webContents || tab.webContents.isDestroyed()) {
    throw new Error(`no live webContents for digest (tab ${tabId})`);
  }

  const expression = `JSON.stringify({
    title: document.title,
    heading: document.querySelector("h1,h2")?.innerText?.slice(0, 200) ?? null,
    url: location.href,
    text: (document.body?.innerText ?? "").replace(/\\s+/g, " ").slice(0, 1200),
  })`;
  const result = await sendCDPCommand<CDP.Runtime.EvaluateResponse>(
    tab.webContents,
    "Runtime.evaluate",
    { expression, returnByValue: true },
  );
  if (result.exceptionDetails) {
    throw new Error(
      `digest evaluate threw: ${result.exceptionDetails.text ?? "unknown"}`,
    );
  }
  const value = result.result.value;
  if (typeof value !== "string") {
    throw new Error("digest evaluate returned no string value");
  }
  const raw = JSON.parse(value) as {
    title: string;
    heading: string | null;
    url: string;
    text: string;
  };

  const haystack = `${raw.text}\n${raw.title}`;
  return {
    title: raw.title,
    heading: raw.heading,
    url: raw.url,
    text: raw.text,
    wallMarkers: WALL_MARKER_PATTERNS.filter((m) => haystack.includes(m)),
  };
}
