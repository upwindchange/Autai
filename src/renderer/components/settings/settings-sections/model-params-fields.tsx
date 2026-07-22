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
import { Switch } from "@/components/ui/switch";
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
 * Renders one control per reasoning_options entry the model declares:
 *  - {type: "toggle"}        → Switch (on/off/null)
 *  - {type: "effort", values}→ ToggleGroup of the declared effort levels
 *  - {type: "budget_tokens"} → Slider bounded by [min, max]
 * Entries stack vertically; a model may declare several (e.g. Claude Opus 4.5
 * has both effort and budget_tokens). `null`/absent values mean "unset" — the
 * translator sends nothing and the model default applies.
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
  const toggle = options.find((o) => o.type === "toggle");
  const effortOpt = options.find((o) => o.type === "effort");
  const budgetOpt = options.find((o) => o.type === "budget_tokens");

  // For effort/budget controls without an explicit toggle, infer "enabled"
  // from whether a value is set — the translator treats any selection as on.
  const effectiveEnabled = enabled ?? (effort != null || budget != null);

  return (
    <div className="space-y-4">
      <Label className="flex items-center gap-1.5 text-sm">
        {t(rk("title"))}
        <HelpTooltip content={t(rk("hint"))} maxWidth={240} />
      </Label>

      {/* Toggle (on/off) — only when the model declares {type: "toggle"} */}
      {toggle && (
        <div className="flex items-center justify-between gap-3">
          <Label className="text-sm text-muted-foreground">
            {t(rk("toggle"))}
          </Label>
          <div className="flex items-center gap-2">
            {enabled !== null && (
              <button
                type="button"
                onClick={() => onChange({ reasoningEnabled: null })}
                className="text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
                aria-label={t(rk("reset"))}
              >
                ×
              </button>
            )}
            <Switch
              checked={effectiveEnabled === true}
              onCheckedChange={(v) =>
                onChange({ reasoningEnabled: effectiveEnabled === v ? null : v })
              }
            />
          </div>
        </div>
      )}

      {/* Effort selector — segmented control of the model's declared values. */}
      {effortOpt && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm text-muted-foreground">
              {t(rk("effort"))}
            </Label>
            {effort !== null && (
              <button
                type="button"
                onClick={() => onChange({ reasoningEffort: null })}
                className="text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
                aria-label={t(rk("reset"))}
              >
                ×
              </button>
            )}
          </div>
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

      {/* Budget tokens — slider bounded by the catalog min/max. */}
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
    </div>
  );
};
