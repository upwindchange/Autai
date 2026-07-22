import { type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Textarea } from "@/components/ui/textarea";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { ChevronDown } from "lucide-react";
import type { ModelParameters, ReasoningOption } from "@shared";

/**
 * Shared editor for the model-parameters subset of ModelParameters + an
 * optional system prompt. Stateless & controlled — the caller owns the draft
 * and decides when to persist (draft+apply for thread-level, onChange for
 * system-level). Used by both the thread-level Popover and the system-level
 * settings Card so the two stay visually identical.
 *
 * `systemPromptPlaceholder` lets the thread-level UI preview the system default
 * in the placeholder, and `i18nNamespace` selects which locale group to read
 * (thread-level uses "common.threadSettings.*", system-level uses
 * "threads.defaultChatParams.*").
 *
 * `reasoningOptions` drives the reasoning/thinking controls from the selected
 * model's catalog entry. When omitted (or the model declares none), no
 * reasoning UI renders — the model simply has no caller-controllable thinking.
 * The three catalog primitives each map to one control: `toggle` → Switch,
 * `effort` → segmented ToggleGroup of the declared values, `budget_tokens` →
 * Slider bounded by the catalog min/max. Multiple options stack vertically.
 */
export interface ModelParamsValue {
  systemPrompt?: string | null;
  params?: ModelParameters | null;
}

export interface ModelParamsFieldsProps {
  value: ModelParamsValue;
  onChange: (next: ModelParamsValue) => void;
  systemPromptPlaceholder?: string;
  i18nNamespace: "common" | "threads" | "providers";
  /** Key prefix within the namespace: "threadSettings" or "defaultChatParams". */
  keyPrefix: string;
  /** Selected model's catalog reasoning_options; omit to render no thinking UI. */
  reasoningOptions?: ReasoningOption[];
  /** Hide the system-prompt field (agent roles have no per-role prompt). */
  hideSystemPrompt?: boolean;
}

export const ModelParamsFields: FC<ModelParamsFieldsProps> = ({
  value,
  onChange,
  systemPromptPlaceholder,
  i18nNamespace,
  keyPrefix,
  reasoningOptions,
  hideSystemPrompt,
}) => {
  const { t } = useTranslation(i18nNamespace);
  const p = value.params ?? {};
  const k = (leaf: string) => `${keyPrefix}.${leaf}`;

  const setParam = <K extends keyof ModelParameters>(
    field: K,
    v: ModelParameters[K] | undefined,
  ) => {
    const nextParams = { ...p };
    if (v === undefined || v === null) {
      delete nextParams[field];
    } else {
      nextParams[field] = v;
    }
    onChange({
      ...value,
      params: Object.keys(nextParams).length > 0 ? nextParams : null,
    });
  };

  const setSystemPrompt = (v: string) => {
    onChange({ ...value, systemPrompt: v.length > 0 ? v : null });
  };

  const hasReasoningControls =
    reasoningOptions && reasoningOptions.length > 0;

  return (
    <div className="space-y-5">
      {/* System prompt (hidden for agent roles — no per-role prompt). */}
      {!hideSystemPrompt && (
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-sm">
            {t(k("systemPrompt"))}
            <HelpTooltip content={t(k("systemPromptHint"))} maxWidth={240} />
          </Label>
          <Textarea
            value={value.systemPrompt ?? ""}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={systemPromptPlaceholder}
            rows={4}
            className="resize-y text-sm"
          />
        </div>
      )}

      {/* Reasoning / thinking — driven by the selected model's catalog entry.
          Models that declare no reasoning_options render nothing here. */}
      {hasReasoningControls && (
        <>
          <Separator />
          <ReasoningControls
            options={reasoningOptions}
            enabled={p.reasoningEnabled ?? null}
            effort={p.reasoningEffort ?? null}
            budget={p.reasoningBudgetTokens ?? null}
            t={t}
            onChange={(patch) => {
              const next = { ...p };
              for (const [key, val] of Object.entries(patch)) {
                if (val === null || val === undefined) delete next[key];
                else next[key] = val;
              }
              onChange({
                ...value,
                params: Object.keys(next).length > 0 ? next : null,
              });
            }}
          />
        </>
      )}

      <Separator />

      {/* Core sampling + output-limit params. Rows are `items-center` so the
          number inputs sit vertically centered with their labels (the prior
          Field-based rows forced top alignment). */}
      <div className="space-y-4">
        <SliderParam
          label={t(k("temperature"))}
          hint={t(k("temperatureHint"))}
          value={p.temperature}
          min={0}
          max={2}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => setParam("temperature", v)}
        />
        <SliderParam
          label={t(k("topP"))}
          hint={t(k("topPHint"))}
          value={p.topP}
          min={0}
          max={1}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => setParam("topP", v)}
        />
        <NumberParam
          label={t(k("maxTokens"))}
          hint={t(k("maxTokensHint"))}
          value={p.maxTokens}
          placeholder="auto"
          min={1}
          onChange={(v) => setParam("maxTokens", v)}
        />
      </div>

      {/* Advanced (collapsed by default) */}
      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">
          {t(k("advanced"))}
          <ChevronDown className="size-3.5 transition-transform [[data-state=open]>&]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">
          <SliderParam
            label={t(k("frequencyPenalty"))}
            hint={t(k("frequencyPenaltyHint"))}
            value={p.frequencyPenalty}
            min={-2}
            max={2}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={(v) => setParam("frequencyPenalty", v)}
          />
          <SliderParam
            label={t(k("presencePenalty"))}
            hint={t(k("presencePenaltyHint"))}
            value={p.presencePenalty}
            min={-2}
            max={2}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={(v) => setParam("presencePenalty", v)}
          />
          <NumberParam
            label={t(k("topK"))}
            hint={t(k("topKHint"))}
            value={p.topK}
            placeholder="auto"
            min={1}
            onChange={(v) => setParam("topK", v)}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

/** Compact readout of a param's current value, with a reset affordance when set. */
const ValueBadge: FC<{ text: string; onReset?: () => void }> = ({
  text,
  onReset,
}) => (
  <span className="flex items-center justify-end gap-1 text-xs tabular-nums text-muted-foreground">
    <span>{text}</span>
    {onReset && (
      <button
        type="button"
        onClick={onReset}
        className="text-muted-foreground/60 transition-colors hover:text-foreground"
        aria-label="reset"
      >
        ×
      </button>
    )}
  </span>
);

interface SliderParamProps {
  label: string;
  hint?: string;
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number | undefined) => void;
}

const SliderParam: FC<SliderParamProps> = ({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <Label className="flex items-center gap-1.5 text-sm">
        {label}
        {hint && <HelpTooltip content={hint} maxWidth={240} />}
      </Label>
      <ValueBadge
        text={value !== undefined ? format(value) : "auto"}
        onReset={value !== undefined ? () => onChange(undefined) : undefined}
      />
    </div>
    <Slider
      value={value !== undefined ? [value] : [min]}
      min={min}
      max={max}
      step={step}
      onValueChange={(arr) => onChange(arr[0])}
      className="w-full"
    />
  </div>
);

interface NumberParamProps {
  label: string;
  hint?: string;
  value: number | undefined;
  placeholder?: string;
  min?: number;
  onChange: (v: number | undefined) => void;
}

const NumberParam: FC<NumberParamProps> = ({
  label,
  hint,
  value,
  placeholder,
  min,
  onChange,
}) => (
  <div className="flex items-center justify-between gap-3">
    <Label className="flex items-center gap-1.5 text-sm">
      {label}
      {hint && <HelpTooltip content={hint} maxWidth={240} />}
    </Label>
    <Input
      type="number"
      value={value ?? ""}
      placeholder={placeholder}
      min={min}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          onChange(undefined);
          return;
        }
        const num = parseInt(raw, 10);
        if (isNaN(num) || (min !== undefined && num < min)) return;
        onChange(num);
      }}
      className="h-8 w-24 text-sm"
    />
  </div>
);

// ──────────────────────────────────────────────
// Reasoning controls — catalog-driven
// ──────────────────────────────────────────────

type TFunc = ReturnType<typeof useTranslation>["t"];

interface ReasoningControlsProps {
  options: ReasoningOption[];
  enabled: boolean | null;
  effort: string | null;
  budget: number | null;
  t: TFunc;
  onChange: (patch: Partial<ModelParameters>) => void;
}

/**
 * Renders the reasoning/thinking controls driven by the model's catalog entry.
 *
 * A single three-button group (Auto / On / Off) governs the mode and maps to
 * `reasoningEnabled`: Auto (null) sends nothing → model default; On (true)
 * enables thinking and reveals the effort/budget sub-controls; Off (false)
 * explicitly disables thinking (the DeepSeek `tool_choice` fix). Effort and
 * budget only render when the model declares them AND mode is On. A model may
 * declare several primitives (e.g. Claude Opus 4.5 has both effort + budget);
 * they stack as independent sub-controls under the mode selector.
 */
const ReasoningControls: FC<ReasoningControlsProps> = ({
  options,
  enabled,
  effort,
  budget,
  t,
  onChange,
}) => {
  const rk = (leaf: string) => `reasoning.${leaf}`;
  const effortOpt = options.find((o) => o.type === "effort");
  const budgetOpt = options.find((o) => o.type === "budget_tokens");

  // Derive the mode from `enabled`. When a value-driven model has effort/budget
  // set but no explicit enabled flag, treat it as On so the sub-controls show.
  const mode: "auto" | "on" | "off" =
    enabled === true ? "on"
    : enabled === false ? "off"
    : effort != null || budget != null ? "on"
    : "auto";

  return (
    <div className="space-y-4">
      <Label className="flex items-center gap-1.5 text-sm">
        {t(rk("title"))}
        <HelpTooltip content={t(rk("hint"))} maxWidth={240} />
      </Label>

      {/* Mode — Auto / On / Off. */}
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(v) => {
          if (!v) return; // re-clicking the active item clears it; ignore
          const next =
            v === "on" ? true : v === "off" ? false : null;
          // Switching to Auto also clears effort/budget so nothing leaks.
          const patch: Partial<ModelParameters> = { reasoningEnabled: next };
          if (next === null || next === false) {
            patch.reasoningEffort = null;
            patch.reasoningBudgetTokens = null;
          }
          onChange(patch);
        }}
        variant="outline"
        size="sm"
        className="w-full"
      >
        <ToggleGroupItem value="auto" className="flex-1">
          {t(rk("auto"))}
        </ToggleGroupItem>
        <ToggleGroupItem value="on" className="flex-1">
          {t(rk("on"))}
        </ToggleGroupItem>
        <ToggleGroupItem value="off" className="flex-1">
          {t(rk("off"))}
        </ToggleGroupItem>
      </ToggleGroup>

      {/* Effort + budget — only meaningful when thinking is on. */}
      {mode === "on" && (
        <>
          {effortOpt && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                {t(rk("effort"))}
              </Label>
              <ToggleGroup
                type="single"
                value={effort ?? ""}
                onValueChange={(v) =>
                  onChange({ reasoningEffort: v || null })
                }
                variant="outline"
                size="sm"
                className="flex-wrap"
              >
                {effortOpt.values.map((val) => {
                  const id = val ?? "default";
                  return (
                    <ToggleGroupItem key={id} value={id}>
                      {id}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </div>
          )}

          {budgetOpt && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm text-muted-foreground">
                  {t(rk("budgetTokens"))}
                </Label>
                <ValueBadge
                  text={budget != null ? String(budget) : "auto"}
                  onReset={
                    budget != null ?
                      () => onChange({ reasoningBudgetTokens: null })
                    : undefined
                  }
                />
              </div>
              <Slider
                value={budget != null ? [budget] : [(budgetOpt.min ?? 1024)]}
                min={budgetOpt.min ?? 1024}
                max={budgetOpt.max ?? 65536}
                step={1024}
                onValueChange={(arr) =>
                  onChange({ reasoningBudgetTokens: arr[0] })
                }
                className="w-full"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};
