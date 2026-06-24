import { type Dispatch, type FC, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { EntertainmentConfig, EntertainmentMode } from "@shared";
import { swapMode } from "../wizardSteps";

interface StepModeProps {
  config: EntertainmentConfig;
  setConfig: Dispatch<SetStateAction<EntertainmentConfig>>;
}

const MODES: { value: EntertainmentMode; labelKey: string; descKey: string }[] =
  [
    {
      value: "dehydrate",
      labelKey: "mode.dehydrate.label",
      descKey: "mode.dehydrate.description",
    },
    {
      value: "interactive",
      labelKey: "mode.interactive.label",
      descKey: "mode.interactive.description",
    },
  ];

export const StepMode: FC<StepModeProps> = ({ config, setConfig }) => {
  const { t } = useTranslation("entertainment");
  return (
    <RadioGroup
      value={config.mode}
      onValueChange={(v) => setConfig(swapMode(config, v as EntertainmentMode))}
      className="gap-3"
    >
      {MODES.map((opt) => (
        <div
          key={opt.value}
          className="flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-accent/40"
        >
          <RadioGroupItem
            value={opt.value}
            id={`ent-mode-${opt.value}`}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <Label htmlFor={`ent-mode-${opt.value}`} className="font-medium">
              {t(opt.labelKey)}
            </Label>
            <p className="text-sm text-muted-foreground">{t(opt.descKey)}</p>
          </div>
        </div>
      ))}
    </RadioGroup>
  );
};
