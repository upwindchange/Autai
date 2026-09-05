/**
 * DOM-history pruning middleware (context-size cap for clicky agents).
 *
 * The crawl agents (advance / TOC / extract) call `getFlattenDOM` /
 * `getDOMTree` repeatedly; every snapshot stays in the conversation history,
 * so each step ships the FULL flattened DOM of every prior step to the model
 * (a 2477-interactive-element page ≈ tens of thousands of tokens per
 * snapshot). Only the LATEST snapshot matters — older ones describe a page
 * state the agent has already acted on. This middleware rewrites the prompt
 * just before it reaches the provider: every DOM-snapshot tool result EXCEPT
 * the last one is replaced by a short placeholder, so per-step context stays
 * flat instead of growing linearly with step count.
 *
 * Implemented at the language-model boundary (not in the agent loop) so all
 * three agents get it by simply wrapping their model, with no per-call-site
 * history surgery.
 */
import {
  wrapLanguageModel,
  type LanguageModel as AiLanguageModel,
  type LanguageModelMiddleware,
} from "ai";
import log from "electron-log/main";

const logger = log.scope("DomHistoryPruning");
/** DOM-snapshot tool names whose older results are pruned. */
const PRUNED_TOOL_NAMES: Record<string, true> = {
  getFlattenDOM: true,
  getDOMTree: true,
};
const PLACEHOLDER = "[older DOM snapshot omitted]";

/** The provider-level call params this middleware transforms. */
type TransformParams = NonNullable<LanguageModelMiddleware["transformParams"]>;
type CallOptions = Parameters<TransformParams>[0]["params"];
/** The provider-level prompt (array of provider-format messages). */
type Prompt = CallOptions["prompt"];
type ToolMessage = Extract<Prompt[number], { role: "tool" }>;
type ToolContentPart = ToolMessage["content"][number];
/** The pruned replacement for a snapshot part's output. */
type ToolResultOutput = { type: "text"; value: string };

type ToolResultPart = Extract<ToolContentPart, { type: "tool-result" }>;

function isSnapshotPart(part: ToolContentPart): part is ToolResultPart {
  return part.type === "tool-result" && part.toolName in PRUNED_TOOL_NAMES;
}

/** Char length of a text output part (0 for other shapes). */
function textLength(output: ToolResultPart["output"]): number {
  return output.type === "text" ? output.value.length : 0;
}

// Process-lifetime totals so a pasted log shows cumulative savings.
let prunedPartsTotal = 0;
let prunedCharsTotal = 0;

/**
 * Single pass over the prompt: find the LAST message containing a prunable
 * tool-result part; in every EARLIER tool message, replace each prunable
 * part's `output` with the placeholder. Never mutates inputs — messages and
 * parts are spread-copied; untouched messages keep referential identity so
 * downstream provider caching is not invalidated wholesale.
 */
function prunePrompt(prompt: Prompt): Prompt {
  let lastSnapshotMessage = -1;
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i];
    if (message.role === "tool" && message.content.some(isSnapshotPart)) {
      lastSnapshotMessage = i;
      break;
    }
  }
  if (lastSnapshotMessage === -1) return prompt; // nothing to prune

  let prunedParts = 0;
  let prunedChars = 0;
  const result = prompt.map((message, i) => {
    if (i >= lastSnapshotMessage || message.role !== "tool") return message;
    const content = message.content.map((part) => {
      if (!isSnapshotPart(part)) return part;
      prunedParts += 1;
      prunedChars += textLength(part.output);
      const output: ToolResultOutput = { type: "text", value: PLACEHOLDER };
      return { ...part, output };
    });
    return { ...message, content };
  });
  if (prunedParts > 0) {
    prunedPartsTotal += prunedParts;
    prunedCharsTotal += prunedChars;
    logger.silly(
      `[crawl-metrics] dom-prune prunedParts=${prunedParts} prunedChars=${prunedChars} promptMsgs=${prompt.length} keptIdx=${lastSnapshotMessage} totals: parts=${prunedPartsTotal} chars=${prunedCharsTotal}`,
    );
  }
  return result;
}

/**
 * Wrap a model so older DOM snapshots never reach the provider. Accepts the
 * repo-wide `LanguageModel` union; a string model-ID (never produced by the
 * provider factory) is rejected loudly, a concrete instance is passed to
 * `wrapLanguageModel` (V2/V3/V4 all match its middleware pipeline).
 */
export function withDomHistoryPruning(model: AiLanguageModel) {
  if (typeof model === "string") {
    throw new Error(
      `withDomHistoryPruning: string model id "${model}" cannot be wrapped`,
    );
  }
  const middleware: LanguageModelMiddleware = {
    transformParams: async ({ params }) => ({
      ...params,
      prompt: prunePrompt(params.prompt),
    }),
  };
  return wrapLanguageModel({ model, middleware });
}
