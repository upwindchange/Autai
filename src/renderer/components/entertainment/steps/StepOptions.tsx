import { type Dispatch, type FC, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ParameterSlider,
  type SliderConfig,
  type SliderValue,
} from "@/components/tool-ui/parameter-slider";
import type {
  DehydrateBasic,
  DehydrateDepth,
  EntertainmentConfig,
} from "@shared";
import {
  DEFAULT_BASIC,
  DEFAULT_DEPTH,
  patchSharedOptions,
} from "../wizardSteps";
import { HelpIcon } from "./HelpIcon";

interface StepOptionsProps {
  config: EntertainmentConfig;
  setConfig: Dispatch<SetStateAction<EntertainmentConfig>>;
}

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

const DEPTH_ITEMS: { key: keyof DehydrateDepth; labelKey: string }[] = [
  {
    key: "dialoguePacing",
    labelKey: "options.dehydrate.depth.dialoguePacing.label",
  },
  {
    key: "dehydrate",
    labelKey: "options.dehydrate.depth.dehydrate.label",
  },
  {
    key: "sceneEnhance",
    labelKey: "options.dehydrate.depth.sceneEnhance.label",
  },
  {
    key: "combatEnhance",
    labelKey: "options.dehydrate.depth.combatEnhance.label",
  },
  {
    key: "emotionEnhance",
    labelKey: "options.dehydrate.depth.emotionEnhance.label",
  },
  {
    key: "literaryEnhance",
    labelKey: "options.dehydrate.depth.literaryEnhance.label",
  },
];

export const StepOptions: FC<StepOptionsProps> = ({ config, setConfig }) => {
  const { t } = useTranslation("entertainment");

  const setBasic = (key: keyof DehydrateBasic, value: boolean) =>
    setConfig((prev) => patchSharedOptions(prev, { basic: { [key]: value } }));

  const onDepthChange = (vals: SliderValue[]) => {
    const patch: Partial<DehydrateDepth> = {};
    for (const v of vals) {
      const known = DEPTH_ITEMS.find((d) => d.key === v.id);
      if (known) patch[known.key] = v.value;
    }
    if (Object.keys(patch).length > 0) {
      setConfig((prev) => patchSharedOptions(prev, { depth: patch }));
    }
  };

  const onFrequencyChange = (vals: SliderValue[]) => {
    const v = vals.find((x) => x.id === "interactionFrequency")?.value;
    if (typeof v === "number") {
      setConfig((prev) =>
        prev.mode === "interactive" ?
          { ...prev, options: { ...prev.options, interactionFrequency: v } }
        : prev,
      );
    }
  };

  // One reset for everything: basic toggles + depth sliders, plus the
  // interaction-frequency slider when in interactive mode. The sliders are
  // rendered with `hideActions`, so this external button is the only reset.
  const resetAll = () => {
    setConfig((prev) => {
      const base = patchSharedOptions(prev, {
        basic: { ...DEFAULT_BASIC },
        depth: { ...DEFAULT_DEPTH },
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

  const depthSliders: SliderConfig[] = DEPTH_ITEMS.map((item) => ({
    id: item.key,
    label: t(item.labelKey),
    min: 1,
    max: 3,
    step: 1,
    value: config.options.depth[item.key],
  }));
  const depthValues: SliderValue[] = DEPTH_ITEMS.map((item) => ({
    id: item.key,
    value: config.options.depth[item.key],
  }));

  // Frequency slider (interactive only). Narrowed via the mode check.
  const freqSliders: SliderConfig[] =
    config.mode === "interactive" ?
      [
        {
          id: "interactionFrequency",
          label: t("options.interactive.frequency.label"),
          min: 1,
          max: 3,
          step: 1,
          value: config.options.interactionFrequency,
        },
      ]
    : [];
  const freqValues: SliderValue[] =
    config.mode === "interactive" ?
      [
        {
          id: "interactionFrequency",
          value: config.options.interactionFrequency,
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={resetAll}>
          {t("options.reset")}
        </Button>
      </div>

      {config.mode === "interactive" && (
        <section className="flex flex-col gap-2">
          <Label className="text-sm font-medium">
            {t("options.interactive.frequency.label")}
          </Label>
          <ParameterSlider
            id="ent-frequency"
            hideActions
            sliders={freqSliders}
            values={freqValues}
            onChange={onFrequencyChange}
          />
          <p className="text-xs text-muted-foreground">
            {t("options.interactive.frequency.levelHint")}
          </p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="flex flex-row flex-wrap items-center gap-x-5 gap-y-2">
            {BASIC_ITEMS.map((item) => (
              <div key={item.key} className="flex items-center gap-1.5">
                <Checkbox
                  id={`ent-basic-${item.key}`}
                  checked={config.options.basic[item.key]}
                  onCheckedChange={(v) => setBasic(item.key, v === true)}
                />
                <Label
                  htmlFor={`ent-basic-${item.key}`}
                  className="cursor-pointer text-sm font-normal"
                >
                  {t(item.labelKey)}
                </Label>
                <HelpIcon label={t(item.tooltipKey)} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          {t("options.dehydrate.depth.levelHint")}
        </p>
        <ParameterSlider
          id="ent-depth"
          hideActions
          sliders={depthSliders}
          values={depthValues}
          onChange={onDepthChange}
        />
      </section>
    </div>
  );
};
