/**
 * Code-level wall guard for the chaptered internet fetch: the shared
 * `reportWall` tool every agent gets, plus the deterministic DOM-text probe
 * the orchestrator runs after every navigation BEFORE starting an LLM agent
 * (a hit blacklists + rotates the site without spending an agent call).
 */

import { tool } from "ai";
import { z } from "zod";
import { createIdGenerator } from "@ai-sdk/provider-utils";
import { getFlattenDOMTool } from "@agents/tools/DOMTools";
import { probeWallMarkers } from "./pure";

const generateId = createIdGenerator({ prefix: "call", size: 24 });

/** Acknowledgment returned by `reportWall` (named for tool-type portability). */
export interface ReportWallResult {
  recorded: boolean;
  reason: string;
}

/**
 * `reportWall` — every fetch agent's wall terminal. The agent supplies the
 * reason; the echo result only acknowledges. The orchestrator detects the
 * wall by scanning the agent's toolResults for this tool's name.
 */
export const reportWallTool = tool({
  description:
    "Report a user-interaction wall you cannot legitimately pass (login wall, paywall/VIP marker anywhere on the site, captcha/human verification, age gate, or a page/TOC that never loads). Call this the moment you see one — do NOT try to click past it.",
  inputSchema: z.object({
    reason: z
      .string()
      .min(1)
      .describe(
        'What kind of wall, e.g. "wall:login", "wall:paywall", "wall:captcha", "wall:age", "wall:vip-markers".',
      ),
  }),
  execute: async (input): Promise<ReportWallResult> => ({
    recorded: true,
    reason: input.reason,
  }),
});

/**
 * Deterministic wall probe: direct-execute getFlattenDOM on the given tab
 * and run `probeWallMarkers` over its textual representation. Returns the
 * matched marker phrase (a wall) or null (clean / nothing conclusive — the
 * LLM agent makes the full visual judgment afterwards).
 */
export async function runDomWallProbe(ctx: {
  sessionId: string;
  activeTabId: string;
}): Promise<string | null> {
  let representation = "";
  try {
    const result: unknown = await getFlattenDOMTool.execute!(
      {},
      {
        toolCallId: generateId(),
        messages: [],
        context: { sessionId: ctx.sessionId, activeTabId: ctx.activeTabId },
      },
    );
    if (
      result != null &&
      typeof result === "object" &&
      "representation" in result &&
      typeof result.representation === "string"
    ) {
      representation = result.representation;
    }
  } catch {
    // Probe is a cost-saving pre-filter — a failing probe must never kill
    // the fetch; the agent's own wall judgment still runs.
    return null;
  }
  return probeWallMarkers(representation);
}
