import { describe, expect, test } from "vitest";
import type { LanguageModel } from "ai";
import { customProviderOptions } from "../src/main/agents/providers/options";

/**
 * customProviderOptions — the per-SDK providerOptions builder. Table-driven
 * over the SDK branches the repo actually ships: catalog params as the base
 * layer, per-call controls overriding field-by-field, and the
 * parallel_tool_calls pacing flag only where requested.
 */

/** Fake LanguageModel carrying just the namespace the builder derives. */
function fakeModel(provider: string): LanguageModel {
  return { provider } as unknown as LanguageModel;
}

const openaiCompat = {
  model: fakeModel("mygateway.chat"),
  npm: "@ai-sdk/openai-compatible",
};
const anthropic = { model: fakeModel("anthropic.chat"), npm: "@ai-sdk/anthropic" };
const openai = { model: fakeModel("openai.chat"), npm: "@ai-sdk/openai" };

describe("customProviderOptions — @ai-sdk/openai-compatible", () => {
  test("catalog reasoning selection still translates (DeepSeek shape)", () => {
    expect(
      customProviderOptions({
        ...openaiCompat,
        params: { reasoningEnabled: false },
      }),
    ).toEqual({ mygateway: { thinking: { type: "disabled" } } });
  });
  test("dash-form provider name emits the camelCase namespace (no deprecation)", () => {
    expect(
      customProviderOptions(
        {
          model: fakeModel("openai-compatible.chat"),
          npm: "@ai-sdk/openai-compatible",
        },
        { reasoningEnabled: false },
      ),
    ).toEqual({ openaiCompatible: { thinking: { type: "disabled" } } });
  });

  test("effort rides alongside the thinking toggle", () => {
    expect(
      customProviderOptions({
        ...openaiCompat,
        params: { reasoningEnabled: true, reasoningEffort: "high" },
      }),
    ).toEqual({
      mygateway: { thinking: { type: "enabled" }, reasoning_effort: "high" },
    });
  });

  test("controls override catalog params field-by-field", () => {
    expect(
      customProviderOptions(
        { ...openaiCompat, params: { reasoningEnabled: true, reasoningEffort: "high" } },
        { reasoningEnabled: false, reasoningEffort: "low" },
      ),
    ).toEqual({
      mygateway: { thinking: { type: "disabled" }, reasoning_effort: "low" },
    });
  });

  test("disallowParallelToolCalls lands in the same namespace (wire passthrough)", () => {
    expect(
      customProviderOptions(openaiCompat, {
        disallowParallelToolCalls: true,
      }),
    ).toEqual({ mygateway: { parallel_tool_calls: false } });
  });

  test("nothing set anywhere → undefined", () => {
    expect(customProviderOptions(openaiCompat)).toBeUndefined();
    expect(
      customProviderOptions({ ...openaiCompat, params: {} }),
    ).toBeUndefined();
  });
});

describe("customProviderOptions — @ai-sdk/anthropic", () => {
  test("disable + budget compose into the thinking object", () => {
    expect(
      customProviderOptions({ ...anthropic, params: { reasoningEnabled: true, reasoningBudgetTokens: 2048 } }),
    ).toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } });
  });

  test("forced-off entertainment controls produce thinking disabled", () => {
    expect(
      customProviderOptions(
        { ...anthropic, params: { reasoningEnabled: true } },
        { reasoningEnabled: false, reasoningEffort: "low" },
      ),
    ).toEqual({ anthropic: { thinking: { type: "disabled" } } });
  });
});

describe("customProviderOptions — @ai-sdk/openai", () => {
  test("effort translates to the typed reasoningEffort key", () => {
    expect(
      customProviderOptions({ ...openai, params: { reasoningEffort: "low" } }),
    ).toEqual({ openai: { reasoningEffort: "low" } });
  });

  test("explicit disable maps to effort none (no disabled knob exists)", () => {
    expect(
      customProviderOptions({ ...openai }, { reasoningEnabled: false }),
    ).toEqual({ openai: { reasoningEffort: "none" } });
  });

  test("effort override wins over the disable-to-none mapping", () => {
    expect(
      customProviderOptions(
        { ...openai, params: { reasoningEffort: "high" } },
        { reasoningEnabled: false, reasoningEffort: "low" },
      ),
    ).toEqual({ openai: { reasoningEffort: "low" } });
  });
});
