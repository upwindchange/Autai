import type { ProviderOptionControls } from "@agents/providers";

/**
 * Provider-option controls shared by EVERY entertainment-mode LLM agent
 * (pipeline1 dehydrate rewriter + probe, pipeline2 rewriter + internet fetch
 * agents, pipeline3 single-page fetch). Thinking is disabled at the API level
 * with reasoning effort pinned to the floor: these agents' deliverable is
 * tool-call content (chapter prose, verdict JSON), and reasoning tokens are
 * pure latency/cost — measured at 2/3–3/4 of output tokens on a real
 * dehydrate run. API-side control supplements the system-prompt instruction
 * ("Reasoning budget" bullet): honored when the upstream model supports
 * thinking/effort parameters, silently ignored otherwise.
 *
 * NOT included: `disallowParallelToolCalls` — that is a per-agent-loop pacing
 * decision (dehydrate drip needs it; fetch agents don't) and stays at the
 * individual call site.
 */
export const ENTERTAINMENT_AGENT_CONTROLS: Readonly<ProviderOptionControls> = {
  reasoningEnabled: false,
  reasoningEffort: "low",
};
