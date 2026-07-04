import { type Dispatch, type FC, type ReactNode, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  DehydrateBasic,
  DehydrateDepth,
  EntertainmentConfig,
  LanguageAdaptation,
} from "@shared";
import {
  DEFAULT_BASIC,
  DEFAULT_DEPTH,
  DEFAULT_LANGUAGE,
  patchSharedOptions,
} from "../wizardSteps";

interface StepOptionsProps {
  config: EntertainmentConfig;
  setConfig: Dispatch<SetStateAction<EntertainmentConfig>>;
}

// --- functional groups (bespoke per group, not a generic toggle mapper) -----

const BASIC_ITEMS: {
  key: keyof DehydrateBasic;
  labelKey: string;
  tooltipKey: string;
}[] = [
  {
    key: "grammarFix",
    labelKey: "options.dehydrate.basic.grammarFix.label",
    tooltipKey: "options.dehydrate.basic.grammarFix.tooltip",
  },
  {
    key: "webSlangFilter",
    labelKey: "options.dehydrate.basic.webSlangFilter.label",
    tooltipKey: "options.dehydrate.basic.webSlangFilter.tooltip",
  },
  {
    key: "preachRemoval",
    labelKey: "options.dehydrate.basic.preachRemoval.label",
    tooltipKey: "options.dehydrate.basic.preachRemoval.tooltip",
  },
];

const DEPTH_ITEMS: {
  key: keyof DehydrateDepth;
  labelKey: string;
  tooltipKey: string;
  exampleKey: string;
}[] = [
  {
    key: "dialoguePacing",
    labelKey: "options.dehydrate.depth.dialoguePacing.label",
    tooltipKey: "options.dehydrate.depth.dialoguePacing.tooltip",
    exampleKey: "options.dehydrate.depth.dialoguePacing.example",
  },
  {
    key: "dehydrate",
    labelKey: "options.dehydrate.depth.dehydrate.label",
    tooltipKey: "options.dehydrate.depth.dehydrate.tooltip",
    exampleKey: "options.dehydrate.depth.dehydrate.example",
  },
  {
    key: "sceneEnhance",
    labelKey: "options.dehydrate.depth.sceneEnhance.label",
    tooltipKey: "options.dehydrate.depth.sceneEnhance.tooltip",
    exampleKey: "options.dehydrate.depth.sceneEnhance.example",
  },
  {
    key: "combatEnhance",
    labelKey: "options.dehydrate.depth.combatEnhance.label",
    tooltipKey: "options.dehydrate.depth.combatEnhance.tooltip",
    exampleKey: "options.dehydrate.depth.combatEnhance.example",
  },
  {
    key: "emotionEnhance",
    labelKey: "options.dehydrate.depth.emotionEnhance.label",
    tooltipKey: "options.dehydrate.depth.emotionEnhance.tooltip",
    exampleKey: "options.dehydrate.depth.emotionEnhance.example",
  },
  {
    key: "literaryEnhance",
    labelKey: "options.dehydrate.depth.literaryEnhance.label",
    tooltipKey: "options.dehydrate.depth.literaryEnhance.tooltip",
    exampleKey: "options.dehydrate.depth.literaryEnhance.example",
  },
];

const LANG_TOGGLE_ITEMS: {
  key: Exclude<keyof LanguageAdaptation, "targetLanguage" | "translate">;
  labelKey: string;
  tooltipKey: string;
  exampleKey: string;
}[] = [
  {
    key: "nameLocalization",
    labelKey: "options.language.nameLocalization.label",
    tooltipKey: "options.language.nameLocalization.tooltip",
    exampleKey: "options.language.nameLocalization.example",
  },
  {
    key: "dialogueSubject",
    labelKey: "options.language.dialogueSubject.label",
    tooltipKey: "options.language.dialogueSubject.tooltip",
    exampleKey: "options.language.dialogueSubject.example",
  },
];

const DEPTH_LEVELS = ["light", "medium", "heavy"] as const;
const FREQ_LEVELS = ["low", "balanced", "high"] as const;
type DepthSegment = (typeof DEPTH_LEVELS)[number] | "off";

// --- local presentational helpers -----------------------------------------

const SectionCard: FC<{
  titleKey: string;
  tooltipKey?: string;
  hintKey?: string;
  children: ReactNode;
}> = ({ titleKey, tooltipKey, hintKey, children }) => {
  const { t } = useTranslation("entertainment");
  return (
    <section className="rounded-lg border bg-card px-4 py-3">
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">{t(titleKey)}</h3>
        {tooltipKey ? <HelpTooltip content={t(tooltipKey)} /> : null}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
      {hintKey ?
        <p className="mt-3 text-xs text-muted-foreground">{t(hintKey)}</p>
      : null}
    </section>
  );
};

const SwitchRow: FC<{
  idBase: string;
  labelKey: string;
  tooltip: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ idBase, labelKey, tooltip, checked, onChange }) => {
  const { t } = useTranslation("entertainment");
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={idBase} className="cursor-pointer text-sm font-normal">
          {t(labelKey)}
        </Label>
        <HelpTooltip content={tooltip} />
      </div>
      <Switch
        id={idBase}
        checked={checked}
        onCheckedChange={onChange}
        size="sm"
      />
    </div>
  );
};

const DepthRow: FC<{
  labelKey: string;
  tooltip: ReactNode;
  field: { enabled: boolean; level: number };
  onSelect: (segment: DepthSegment) => void;
}> = ({ labelKey, tooltip, field, onSelect }) => {
  const { t } = useTranslation("entertainment");
  const value: DepthSegment = field.enabled ?
      DEPTH_LEVELS[field.level - 1] ?? "medium"
    : "off";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-normal">{t(labelKey)}</span>
        <HelpTooltip content={tooltip} />
      </div>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={value}
        onValueChange={(v) => {
          // Radix emits "" when the active item is re-clicked; ignore (no deselect).
          if (v) onSelect(v as DepthSegment);
        }}
        aria-label={t(labelKey)}
      >
        <ToggleGroupItem value="off">
          {t("options.depth.level.off")}
        </ToggleGroupItem>
        <ToggleGroupItem value="light">
          {t("options.depth.level.light")}
        </ToggleGroupItem>
        <ToggleGroupItem value="medium">
          {t("options.depth.level.medium")}
        </ToggleGroupItem>
        <ToggleGroupItem value="heavy">
          {t("options.depth.level.heavy")}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
};

// --- step ------------------------------------------------------------------

export const StepOptions: FC<StepOptionsProps> = ({ config, setConfig }) => {
  const { t } = useTranslation("entertainment");
  const lang = config.options.language;

  const setBasic = (key: keyof DehydrateBasic, value: boolean) =>
    setConfig((prev) => patchSharedOptions(prev, { basic: { [key]: value } }));

  const onDepthSelect = (key: keyof DehydrateDepth, segment: DepthSegment) =>
    setConfig((prev) =>
      patchSharedOptions(prev, {
        depth: {
          [key]:
            segment === "off" ?
              { enabled: false }
            : { enabled: true, level: DEPTH_LEVELS.indexOf(segment) + 1 },
        },
      }),
    );

  const setLangToggle = (
    key: Exclude<keyof LanguageAdaptation, "targetLanguage">,
    enabled: boolean,
  ) =>
    setConfig((prev) =>
      patchSharedOptions(prev, { language: { [key]: { enabled } } }),
    );

  const setTargetLanguage = (value: string) =>
    setConfig((prev) =>
      patchSharedOptions(prev, { language: { targetLanguage: value } }),
    );

  const setCustomInstruction = (value: string) =>
    setConfig((prev) => patchSharedOptions(prev, { customInstruction: value }));

  const resetAll = () => {
    setConfig((prev) => {
      const base = patchSharedOptions(prev, {
        basic: { ...DEFAULT_BASIC },
        depth: structuredClone(DEFAULT_DEPTH),
        language: structuredClone(DEFAULT_LANGUAGE),
        customInstruction: "",
      });
      if (base.mode === "interactive") {
        return { ...base, options: { ...base.options, interactionFrequency: 2 } };
      }
      return base;
    });
  };

  // Body + a smaller, dimmed language-native example line.
  const tip = (bodyKey: string, exampleKey: string): ReactNode => (
    <span className="flex flex-col gap-1">
      <span>{t(bodyKey)}</span>
      <span className="opacity-80">{t(exampleKey)}</span>
    </span>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={resetAll}>
          {t("options.reset")}
        </Button>
      </div>

      {config.mode === "interactive" && (
        <SectionCard titleKey="options.interactive.frequency.label">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={
              FREQ_LEVELS[config.options.interactionFrequency - 1] ?? "balanced"
            }
            onValueChange={(v) => {
              const idx = FREQ_LEVELS.indexOf(v as (typeof FREQ_LEVELS)[number]);
              if (idx >= 0) {
                setConfig((prev) =>
                  prev.mode === "interactive" ?
                    { ...prev, options: { ...prev.options, interactionFrequency: idx + 1 } }
                  : prev,
                );
              }
            }}
            aria-label={t("options.interactive.frequency.label")}
          >
            <ToggleGroupItem value="low">
              {t("options.interactive.frequency.level.low")}
            </ToggleGroupItem>
            <ToggleGroupItem value="balanced">
              {t("options.interactive.frequency.level.balanced")}
            </ToggleGroupItem>
            <ToggleGroupItem value="high">
              {t("options.interactive.frequency.level.high")}
            </ToggleGroupItem>
          </ToggleGroup>
        </SectionCard>
      )}

      <SectionCard titleKey="options.section.cleanup.title">
        {BASIC_ITEMS.map((item) => (
          <SwitchRow
            key={item.key}
            idBase={`ent-basic-${item.key}`}
            labelKey={item.labelKey}
            tooltip={t(item.tooltipKey)}
            checked={config.options.basic[item.key]}
            onChange={(v) => setBasic(item.key, v)}
          />
        ))}
      </SectionCard>

      <SectionCard
        titleKey="options.section.rewrite.title"
        hintKey="options.section.rewrite.hint"
      >
        {DEPTH_ITEMS.map((item) => (
          <DepthRow
            key={item.key}
            labelKey={item.labelKey}
            tooltip={tip(item.tooltipKey, item.exampleKey)}
            field={config.options.depth[item.key]}
            onSelect={(seg) => onDepthSelect(item.key, seg)}
          />
        ))}
      </SectionCard>

      <SectionCard
        titleKey="options.section.language.title"
        tooltipKey="options.section.language.tooltip"
      >
        {/* Translate: a single option — the switch gates the language input.
            The language only becomes fillable once translation is on. */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label
                htmlFor="ent-lang-translate"
                className="cursor-pointer text-sm font-normal"
              >
                {t("options.language.translate.label")}
              </Label>
              <HelpTooltip
                content={tip(
                  "options.language.translate.tooltip",
                  "options.language.translate.example",
                )}
              />
            </div>
            <Switch
              id="ent-lang-translate"
              checked={lang.translate.enabled}
              onCheckedChange={(v) => setLangToggle("translate", v)}
              size="sm"
            />
          </div>
          {lang.translate.enabled && (
            <Textarea
              data-no-enter-advance
              value={lang.targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              placeholder={t("options.language.targetLanguage.placeholder")}
              rows={2}
            />
          )}
        </div>
        {LANG_TOGGLE_ITEMS.map((item) => (
          <SwitchRow
            key={item.key}
            idBase={`ent-lang-${item.key}`}
            labelKey={item.labelKey}
            tooltip={tip(item.tooltipKey, item.exampleKey)}
            checked={lang[item.key].enabled}
            onChange={(v) => setLangToggle(item.key, v)}
          />
        ))}
      </SectionCard>

      <SectionCard titleKey="options.section.custom.title">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="ent-custom-instruction" className="text-sm font-medium">
              {t("options.customInstruction.label")}
            </Label>
            <HelpTooltip content={t("options.customInstruction.tooltip")} />
          </div>
          <Textarea
            id="ent-custom-instruction"
            data-no-enter-advance
            value={config.options.customInstruction}
            onChange={(e) => setCustomInstruction(e.target.value)}
            placeholder={t("options.customInstruction.placeholder")}
            rows={3}
          />
        </div>
      </SectionCard>
    </div>
  );
};
