import { type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { ChevronDown } from "lucide-react";
import type { ModelParameters } from "@shared";
import { cn } from "@/lib/utils";

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
 */
export interface ModelParamsValue {
  systemPrompt?: string | null;
  params?: ModelParameters | null;
}

export interface ModelParamsFieldsProps {
  value: ModelParamsValue;
  onChange: (next: ModelParamsValue) => void;
  systemPromptPlaceholder?: string;
  i18nNamespace: "common" | "threads";
  /** Key prefix within the namespace: "threadSettings" or "defaultChatParams". */
  keyPrefix: string;
}

export const ModelParamsFields: FC<ModelParamsFieldsProps> = ({
  value,
  onChange,
  systemPromptPlaceholder,
  i18nNamespace,
  keyPrefix,
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

  return (
    <div className="space-y-4">
      {/* System prompt */}
      <Field>
        <FieldLabel className="flex items-center gap-1.5">
          {t(k("systemPrompt"))}
          <HelpTooltip content={t(k("systemPromptHint"))} maxWidth={240} />
        </FieldLabel>
        <Textarea
          value={value.systemPrompt ?? ""}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder={systemPromptPlaceholder}
          rows={6}
          className="resize-y text-sm"
        />
      </Field>

      {/* Core numeric params */}
      <SliderField
        label={t(k("temperature"))}
        hint={t(k("temperatureHint"))}
        value={p.temperature}
        min={0}
        max={2}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onChange={(v) => setParam("temperature", v)}
      />
      <NumberField
        label={t(k("maxTokens"))}
        hint={t(k("maxTokensHint"))}
        value={p.maxTokens}
        placeholder="auto"
        min={1}
        onChange={(v) => setParam("maxTokens", v)}
      />
      <SliderField
        label={t(k("topP"))}
        hint={t(k("topPHint"))}
        value={p.topP}
        min={0}
        max={1}
        step={0.05}
        format={(v) => v.toFixed(2)}
        onChange={(v) => setParam("topP", v)}
      />

      {/* Advanced (collapsed by default) */}
      <Collapsible>
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center justify-between rounded-md px-2 py-1.5",
            "text-xs font-medium text-muted-foreground hover:bg-muted",
          )}
        >
          {t(k("advanced"))}
          <ChevronDown className="size-3.5 transition-transform [[data-state=open]>&]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">
          <SliderField
            label={t(k("frequencyPenalty"))}
            hint={t(k("frequencyPenaltyHint"))}
            value={p.frequencyPenalty}
            min={-2}
            max={2}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={(v) => setParam("frequencyPenalty", v)}
          />
          <SliderField
            label={t(k("presencePenalty"))}
            hint={t(k("presencePenaltyHint"))}
            value={p.presencePenalty}
            min={-2}
            max={2}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={(v) => setParam("presencePenalty", v)}
          />
          <NumberField
            label={t(k("topK"))}
            hint={t(k("topKHint"))}
            value={p.topK}
            placeholder="auto"
            min={1}
            onChange={(v) => setParam("topK", v)}
          />
          {/* stopSequences: comma-separated input, max 4 */}
          <Field>
            <FieldLabel className="flex items-center gap-1.5">
              {t(k("stopSequences"))}
              <HelpTooltip content={t(k("stopSequencesHint"))} maxWidth={240} />
            </FieldLabel>
            <Input
              type="text"
              value={p.stopSequences?.join(", ") ?? ""}
              onChange={(e) => {
                const parts = e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 4);
                setParam("stopSequences", parts.length > 0 ? parts : undefined);
              }}
              placeholder={t(k("stopSequencesPlaceholder"))}
              className="text-sm"
            />
          </Field>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

interface SliderFieldProps {
  label: string;
  hint?: string;
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number | undefined) => void;
}

const SliderField: FC<SliderFieldProps> = ({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}) => (
  <Field orientation="horizontal">
    <FieldContent className="flex-1">
      <FieldLabel className="flex items-center gap-1.5 text-sm">
        {label}
        {hint && <HelpTooltip content={hint} maxWidth={240} />}
      </FieldLabel>
    </FieldContent>
    <div className="flex flex-1 items-center gap-3">
      <Slider
        value={value !== undefined ? [value] : [min]}
        min={min}
        max={max}
        step={step}
        onValueChange={(arr) => onChange(arr[0])}
        className="flex-1"
      />
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {value !== undefined ? format(value) : "auto"}
      </span>
      {value !== undefined && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="text-xs text-muted-foreground hover:text-foreground"
          aria-label="reset"
        >
          ×
        </button>
      )}
    </div>
  </Field>
);

interface NumberFieldProps {
  label: string;
  hint?: string;
  value: number | undefined;
  placeholder?: string;
  min?: number;
  onChange: (v: number | undefined) => void;
}

const NumberField: FC<NumberFieldProps> = ({
  label,
  hint,
  value,
  placeholder,
  min,
  onChange,
}) => (
  <Field orientation="horizontal">
    <FieldContent className="flex-1">
      <Label className="flex items-center gap-1.5 text-sm">
        {label}
        {hint && <HelpTooltip content={hint} maxWidth={240} />}
      </Label>
    </FieldContent>
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
  </Field>
);
