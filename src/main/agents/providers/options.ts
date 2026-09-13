/**
 * Provider-option translation — pure, dependency-free leaf module so tests
 * can import it without dragging in the DB/service layer. Re-exported from
 * ./index; call sites import from "@agents/providers" as usual.
 */

import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { ModelParameters } from "@shared";
import log from "electron-log/main";

const logger = log.scope("Providers");

/**
 * SDK packages whose provider-option wire format we know how to translate.
 * Other `@ai-sdk/*` packages get a one-time "not supported" log and no
 * providerOptions — the selection is silently ignored for them. Add a branch
 * in `customProviderOptions` to teach the translator a new SDK.
 */
const warnedUnsupportedReasoningSdk = new Set<string>();

/**
 * Derive the providerOptions namespace key for a resolved model. Each SDK
 * exposes its namespace on the model instance as `model.provider`
 * (`LanguageModelV4.provider`, see @ai-sdk/provider). Dedicated SDKs bake a
 * constant (`"groq"`, `"mistral"`); `@ai-sdk/openai-compatible` uses the
 * provider dir name (`"deepseek"`). All follow the `<name>.<modelType>`
 * convention, so splitting on `.` recovers the namespace programmatically — no
 * hardcoded mapping.
 *
 * For openai-compatible there is also a canonical folder-independent key
 * `"openaiCompatible"` the adapter reads, but using the derived provider name
 */
export function providerOptionsNamespace(model: LanguageModel): string {
  // `LanguageModel` is a union of `GlobalProviderModelId | LanguageModelV3 | V2`;
  // only the object variants carry `provider`. Guard at runtime.
  const provider =
    typeof model === "object" && model !== null && "provider" in model ?
      (model as { provider: string }).provider
    : "";
  return provider.split(".")[0].trim();
}

/**
 * Per-call provider-option controls beyond the catalog's reasoning params.
 * Flat keys — one per knob — so each composes with its catalog counterpart by
 * a single `??` (see `customProviderOptions`).
 */
export type ProviderOptionControls = {
  /** Force one tool call per assistant message (`parallel_tool_calls: false`).
   *  A per-agent-loop pacing decision — never a persistent model setting. */
  disallowParallelToolCalls?: boolean;
  /** Override `params.reasoningEnabled` (e.g. entertainment agents force off). */
  reasoningEnabled?: boolean;
  /** Override `params.reasoningEffort`. */
  reasoningEffort?: string;
  /** Override `params.reasoningBudgetTokens`. */
  reasoningBudgetTokens?: number;
};

/**
 * Mutable builder shape for the providerOptions inner object. `ProviderOptions`
 * (from @ai-sdk/provider-utils) is `Record<string, JSONObject>`, where JSONObject
 * is a recursive `{ [k: string]: JSONValue }`. The recursive alias below matches
 * that structure and lets per-SDK branches accumulate keys (e.g. add
 * `reasoning_effort` only when set) while still satisfying the return type.
 */
type ProviderOptionPayload = { [key: string]: ProviderOptionValue };
type ProviderOptionValue =
  | string
  | number
  | boolean
  | null
  | ProviderOptionPayload
  | ProviderOptionValue[];

/**
 * Build the per-call `providerOptions` for one model: catalog reasoning params
 * (`model_assignments.params`) overlaid with per-call `controls` (each control
 * wins over the same-named param; `undefined` control = inherit the param).
 * This is the ONE place where SDK semantics must be hardcoded: the catalog
 * records *what the user may choose* (toggle / effort value / token budget),
 * but the wire format is genuinely SDK-specific and the catalog cannot encode
 * it. Each branch below is keyed by SDK npm package, not by provider dir —
 * multiple providers can share one SDK package.
 *
 * Returns `undefined` when nothing is set (params and controls both silent) —
 * callers spread it with `...(x && { providerOptions: x })`.
 *
 * Verified wire formats:
 *  - @ai-sdk/openai-compatible (DeepSeek): thinking.type = enabled|disabled,
 *    reasoning_effort; the adapter reads providerOptions[<providerDir>].
 *    IMPORTANT: `thinking` and `parallel_tool_calls` are NOT in the adapter's
 *    typed schema — they reach the JSON request body only via the adapter's
 *    unknown-namespace-key passthrough (the same mechanism `reasoning_effort`
 *    used before it was typed). Sent unconditionally; the upstream honors
 *    them when it supports them and ignores them otherwise.
 *  - @ai-sdk/anthropic: thinking = { type: "enabled"|"disabled", budgetTokens };
 *    the adapter reads providerOptions.anthropic and camelCases budget_tokens.
 *  - @ai-sdk/openai: reasoningEffort (a model setting overridable via
 *    providerOptions.openai.reasoningEffort); emits reasoning_effort on the
 *    wire. No "disabled" knob exists — reasoning off is expressed as
 *    reasoningEffort "none", which the branch below maps an explicit disable
 *    to when no effort override was given.
 *
 * Untranslated SDKs log once and no-op — the reasoning selection is silently
 * ignored rather than emitting a malformed request. Extend by adding a branch.
 */
export function customProviderOptions(
  model: {
    model: LanguageModel;
    npm: string;
    params?: ModelParameters;
  },
  controls?: ProviderOptionControls,
): ProviderOptions | undefined {
  const params = model.params;
  const enabled = controls?.reasoningEnabled ?? params?.reasoningEnabled;
  const effort = controls?.reasoningEffort ?? params?.reasoningEffort;
  const budget =
    controls?.reasoningBudgetTokens ?? params?.reasoningBudgetTokens;
  const noParallel = controls?.disallowParallelToolCalls === true;

  // Nothing set anywhere → nothing to send. Distinguish undefined (unset) from
  // explicit false (disabled) — false is the DeepSeek fix and must produce a
  // payload.
  if (
    enabled === undefined &&
    effort === undefined &&
    budget === undefined &&
    !noParallel
  ) {
    return undefined;
  }

  switch (model.npm) {
    case "@ai-sdk/openai-compatible": {
      // The adapter reads providerOptions[<its name>] and merges in
      // providerOptions[toCamelCase(<its name>)], warning when the dash form
      // of a dash-containing name is used (e.g. "openai-compatible"). Emit the
      // camelCase form of the DERIVED name — warning-free for dash names
      // ("openai-compatible" → "openaiCompatible") and a no-op for dash-free
      // ones ("deepseek" → "deepseek", which also matches DeepSeek's expected
      // namespace).
      const raw = providerOptionsNamespace(model.model);
      const ns = raw.replace(/[-_]([a-z])/g, (g) => g[1].toUpperCase());
      const payload: ProviderOptionPayload = {};
      if (enabled !== undefined || effort !== undefined) {
        payload.thinking = {
          type: enabled === false ? "disabled" : "enabled",
        };
        if (effort) payload.reasoning_effort = effort;
      }
      if (noParallel) payload.parallel_tool_calls = false;
      return { [ns]: payload };
    }
    case "@ai-sdk/anthropic": {
      const payload: ProviderOptionPayload = {};
      if (enabled !== undefined || budget !== undefined) {
        const thinking: ProviderOptionPayload = {
          type: enabled === false ? "disabled" : "enabled",
        };
        // The anthropic adapter camelCases budget_tokens → budgetTokens.
        if (thinking.type === "enabled" && budget != null) {
          thinking.budgetTokens = budget;
        }
        payload.thinking = thinking;
      }
      // parallel_tool_calls is OpenAI-protocol; anthropic has no equivalent
      // knob in its schema — silently omitted there.
      return { anthropic: payload };
    }
    case "@ai-sdk/openai": {
      const payload: ProviderOptionPayload = {};
      if (effort) payload.reasoningEffort = effort;
      // No "disabled" knob on OpenAI: explicit disable without an effort
      // override can only be expressed as effort "none" — map it, so the
      // entertainment agents' forced-off actually lands.
      if (enabled === false && !effort) payload.reasoningEffort = "none";
      if (noParallel) payload.parallel_tool_calls = false;
      if (!Object.keys(payload).length) return undefined;
      return { openai: payload };
      // NOTE: @ai-sdk/openai's typed schema has no parallel_tool_calls; it is
      // dropped by zod stripping — a no-op, kept above for the day it is
      // typed. reasoningEffort IS typed and always lands.
    }
    default: {
      if (!warnedUnsupportedReasoningSdk.has(model.npm)) {
        warnedUnsupportedReasoningSdk.add(model.npm);
        logger.warn(
          "provider options ignored: SDK package not yet supported by the translator",
          { npm: model.npm },
        );
      }
      return undefined;
    }
  }
}