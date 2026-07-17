import {
  useState,
  type Dispatch,
  type FC,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  CrossChapterTactics,
  DehydrateBasic,
  DehydrateDepth,
  EntertainmentConfig,
  LanguageAdaptation,
  SituationTactics,
} from "@shared";
import {
  CROSS_CHAPTER_CATEGORIES,
  CROSS_CHAPTER_TACTIC_KEYS,
  fillCrossChapterTactics,
  fillSituationTactics,
  SITUATION_CATEGORIES,
  SITUATION_TACTIC_KEYS,
} from "@shared";
import {
  DEFAULT_BASIC,
  DEFAULT_CROSS_CHAPTER,
  DEFAULT_DEPTH,
  DEFAULT_LANGUAGE,
  DEFAULT_SITUATION,
  isCrossChapterAvailable,
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
];

// Filler-stripping tactic blocks (情境脱水 + 章节并写) are rendered by the
// shared `TacticBlock` component below, driven by the shared schema's category
// constants (`SITUATION_CATEGORIES`, `CROSS_CHAPTER_CATEGORIES`).

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
    <section className="flex flex-col rounded-lg border bg-card px-4 py-3">
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">{t(titleKey)}</h3>
        {tooltipKey ?
          <HelpTooltip content={t(tooltipKey)} />
        : null}
      </div>
      {/* Body flexes so a child (e.g. the custom-instruction textarea) can fill
          the card when a grid row stretches it to match a taller neighbour.
          min-h-0 lets the flex item shrink below its content's natural size. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">{children}</div>
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

// One compact grid cell for a filler-stripping tactic — checkbox + wrapping
// label + help tooltip. Mirrors SwitchRow's htmlFor/id pattern (click the label
// text to toggle), sized for a dense responsive grid. `blockKey` is the i18n
// namespace root and id prefix ("situation" | "crossChapter"); the tactic's
// label/tooltip keys resolve to `options.<blockKey>.tactic.<tactic>.{label,tooltip}`.
const TacticCheckbox: FC<{
  blockKey: "situation" | "crossChapter";
  tactic: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ blockKey, tactic, checked, onChange }) => {
  const { t } = useTranslation("entertainment");
  const id = `ent-${blockKey}-${tactic}`;
  return (
    <div className="flex items-start gap-2 rounded-md border p-2 hover:bg-accent/50">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
        className="mt-0.5 size-3.5"
      />
      <div className="flex min-w-0 items-start gap-1">
        <Label htmlFor={id} className="cursor-pointer text-xs leading-snug">
          {t(`options.tactic.${tactic}.label`)}
        </Label>
        <HelpTooltip content={t(`options.tactic.${tactic}.tooltip`)} />
      </div>
    </div>
  );
};

// A reusable collapsible panel for a `{ strength, tactics }` filler-stripping
// block — used twice, for 情境脱水 (situation) and 章节并写 (crossChapter).
// Identical layout in both: header with title + enabled-count + expand chevron,
// a row with the 关/轻/中/重 strength dial + the master "All" switch, and a body
// of grouped tactic-checkbox grids (dimmed when the strength is 关). `blockKey`
// drives the i18n namespace and the tactic-cell ids; `categories`/`allTacticKeys`
// come straight from the shared schema constants.
//
// `disabled` greys out and blocks the WHOLE block (used for 章节并写 when the
// source isn't a chaptered file upload). It's separate from the strength dial's
// 关 dim: 关 means "off until you pick an intensity", `disabled` means "not
// available for this source at all". When disabled, the control row (dial +
// master switch) is hidden and replaced by a one-line explanation.
const TacticBlock: FC<{
  blockKey: "situation" | "crossChapter";
  categories: readonly {
    key: string;
    tactics: readonly string[];
  }[];
  allTacticKeys: readonly string[];
  strength: number;
  tactics: Record<string, boolean>;
  onStrength: (segment: DepthSegment) => void;
  onTactic: (tactic: string, value: boolean) => void;
  onAll: (value: boolean) => void;
  disabled?: boolean;
  disabledHintKey?: string;
}> = ({
  blockKey,
  categories,
  allTacticKeys,
  strength,
  tactics,
  onStrength,
  onTactic,
  onAll,
  disabled = false,
  disabledHintKey,
}) => {
  const { t } = useTranslation("entertainment");
  const [open, setOpen] = useState(false);
  const enabledCount = allTacticKeys.filter((k) => tactics[k]).length;
  const allOn = enabledCount === allTacticKeys.length;
  // strength 0 = off (关); 1/2/3 → light/medium/heavy.
  const segment: DepthSegment =
    strength === 0 ? "off" : (DEPTH_LEVELS[strength - 1] ?? "medium");
  const active = strength > 0;
  return (
    <Collapsible
      open={open && !disabled}
      onOpenChange={(o) => !disabled && setOpen(o)}
      className={cn("rounded-lg border bg-card", disabled && "opacity-60")}
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold">
              {t(`options.section.${blockKey}.title`)}
            </h3>
            <HelpTooltip content={t(`options.section.${blockKey}.hint`)} />
            <span className="text-xs text-muted-foreground">
              ({enabledCount}/{allTacticKeys.length})
            </span>
          </div>
          {!disabled && (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <ChevronDownIcon
                  className={cn(
                    "size-4 transition-transform",
                    open && "rotate-180",
                  )}
                />
              </Button>
            </CollapsibleTrigger>
          )}
        </div>
        {disabled ?
          // Disabled block: show why, no controls. pointer-events-none keeps
          // any nested interactive element inert without per-element wiring.
          disabledHintKey && (
            <p className="pointer-events-none text-xs text-muted-foreground">
              {t(disabledHintKey)}
            </p>
          )
        : <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t(`options.${blockKey}.strength.label`)}
              </span>
              <HelpTooltip
                content={t(`options.${blockKey}.strength.tooltip`)}
              />
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={segment}
                onValueChange={(v) => {
                  // Radix emits "" when the active item is re-clicked; ignore.
                  if (v) onStrength(v as DepthSegment);
                }}
                aria-label={t(`options.${blockKey}.strength.label`)}
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
            <div className="flex items-center gap-2">
              <Label
                htmlFor={`ent-${blockKey}-all`}
                className="cursor-pointer text-xs text-muted-foreground"
              >
                {t(`options.${blockKey}.enableAll`)}
              </Label>
              <Switch
                id={`ent-${blockKey}-all`}
                checked={allOn}
                onCheckedChange={onAll}
                size="sm"
              />
            </div>
          </div>
        }
      </div>
      {/* Body: grouped tactic-checkbox grids. When the strength dial is 关,
          nothing in this block takes effect — dim the grid to make that clear. */}
      {!disabled && (
        <CollapsibleContent className="border-t">
          <div
            className={cn(
              "flex flex-col gap-4 px-4 py-3",
              !active && "pointer-events-none opacity-50",
            )}
          >
            {categories.map((cat) => {
              const catEnabled = cat.tactics.filter((k) => tactics[k]);
              return (
                <div key={cat.key} className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t(`options.category.${cat.key}`)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({catEnabled.length}/{cat.tactics.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
                    {cat.tactics.map((tk) => (
                      <TacticCheckbox
                        key={tk}
                        blockKey={blockKey}
                        tactic={tk}
                        checked={tactics[tk]}
                        onChange={(v) => onTactic(tk, v)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
};

const DepthRow: FC<{
  labelKey: string;
  tooltip: ReactNode;
  field: { enabled: boolean; level: number };
  onSelect: (segment: DepthSegment) => void;
}> = ({ labelKey, tooltip, field, onSelect }) => {
  const { t } = useTranslation("entertainment");
  const value: DepthSegment =
    field.enabled ? (DEPTH_LEVELS[field.level - 1] ?? "medium") : "off";
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
  // 章节并写 needs fast access to all chapters' content, which only a local
  // file upload provides — grey it out (with an explanation) otherwise.
  const crossChapterAvailable = isCrossChapterAvailable(config);

  const setBasic = (key: keyof DehydrateBasic, value: boolean) =>
    setConfig((prev) => patchSharedOptions(prev, { basic: { [key]: value } }));

  // --- 情境脱水 (situation) handlers ----------------------------------------

  const setSituation = (key: keyof SituationTactics, value: boolean) =>
    setConfig((prev) =>
      patchSharedOptions(prev, { situation: { tactics: { [key]: value } } }),
    );

  // Master switch: set every tactic on/off at once. Passing a complete
  // SituationTactics through the patcher's tactics merge replaces all keys.
  const setAllSituation = (value: boolean) =>
    setConfig((prev) =>
      patchSharedOptions(prev, {
        situation: { tactics: fillSituationTactics(value) },
      }),
    );

  // The strength dial (off/light/medium/heavy ↔ 0/1/2/3) gates the whole
  // situational feature: 0 = no situational dehydration at all, even with
  // tactics checked; 1–3 = strip the checked tactics at that intensity.
  const setSituationStrength = (segment: DepthSegment) =>
    setConfig((prev) =>
      patchSharedOptions(prev, {
        situation: {
          strength: segment === "off" ? 0 : DEPTH_LEVELS.indexOf(segment) + 1,
        },
      }),
    );

  // --- 章节并写 (crossChapter) handlers — mirror the situation ones ----------

  const setCrossChapter = (key: keyof CrossChapterTactics, value: boolean) =>
    setConfig((prev) =>
      patchSharedOptions(prev, {
        crossChapter: { tactics: { [key]: value } },
      }),
    );

  const setAllCrossChapter = (value: boolean) =>
    setConfig((prev) =>
      patchSharedOptions(prev, {
        crossChapter: { tactics: fillCrossChapterTactics(value) },
      }),
    );

  const setCrossChapterStrength = (segment: DepthSegment) =>
    setConfig((prev) =>
      patchSharedOptions(prev, {
        crossChapter: {
          strength: segment === "off" ? 0 : DEPTH_LEVELS.indexOf(segment) + 1,
        },
      }),
    );

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
        situation: { ...DEFAULT_SITUATION },
        crossChapter: { ...DEFAULT_CROSS_CHAPTER },
        depth: structuredClone(DEFAULT_DEPTH),
        language: structuredClone(DEFAULT_LANGUAGE),
        customInstruction: "",
      });
      if (base.mode === "interactive") {
        return {
          ...base,
          options: { ...base.options, interactionFrequency: 2 },
        };
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
              const idx = FREQ_LEVELS.indexOf(
                v as (typeof FREQ_LEVELS)[number],
              );
              if (idx >= 0) {
                setConfig((prev) =>
                  prev.mode === "interactive" ?
                    {
                      ...prev,
                      options: {
                        ...prev.options,
                        interactionFrequency: idx + 1,
                      },
                    }
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

      {/* Surface-level text toggles pair up on wide screens: cleanup switches +
          language adaptation are both simple on/off rows, so they read well
          side-by-side once the wizard is wide enough. */}
      <div className="grid gap-5 lg:grid-cols-2">
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
              <>
                <Label
                  htmlFor="ent-lang-target"
                  className="text-sm font-medium"
                >
                  <span>{t("options.language.targetLanguage.label")}</span>
                  <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="ent-lang-target"
                  data-no-enter-advance
                  value={lang.targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  placeholder={t("options.language.targetLanguage.placeholder")}
                  rows={2}
                />
              </>
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
      </div>

      <TacticBlock
        blockKey="situation"
        categories={SITUATION_CATEGORIES}
        allTacticKeys={SITUATION_TACTIC_KEYS}
        strength={config.options.situation.strength}
        tactics={config.options.situation.tactics}
        onStrength={setSituationStrength}
        onTactic={(k, v) => setSituation(k as keyof SituationTactics, v)}
        onAll={setAllSituation}
      />

      <TacticBlock
        blockKey="crossChapter"
        categories={CROSS_CHAPTER_CATEGORIES}
        allTacticKeys={CROSS_CHAPTER_TACTIC_KEYS}
        strength={config.options.crossChapter.strength}
        tactics={config.options.crossChapter.tactics}
        onStrength={setCrossChapterStrength}
        onTactic={(k, v) => setCrossChapter(k as keyof CrossChapterTactics, v)}
        onAll={setAllCrossChapter}
        disabled={!crossChapterAvailable}
        disabledHintKey="options.crossChapter.disabled.hint"
      />

      {/* Rewrite intensity + custom instruction pair on wide screens — both
          are vertical stacks that read fine side-by-side once there's room. */}
      <div className="grid gap-5 lg:grid-cols-2">
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

        <SectionCard titleKey="options.section.custom.title">
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label
                htmlFor="ent-custom-instruction"
                className="text-sm font-medium"
              >
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
              // Override the base Textarea's field-sizing-content (which
              // auto-sizes to content and ignores flex height) so this box
              // fills the card instead of leaving a tall empty gap below it.
              className="min-h-24 flex-1 [field-sizing:fixed] resize-none"
            />
          </div>
        </SectionCard>
      </div>
    </div>
  );
};
