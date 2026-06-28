import { type Dispatch, type FC, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { EntertainmentConfig, EntertainmentMode } from "@shared";
import { swapMode } from "../wizardSteps";

interface StepModeProps {
  config: EntertainmentConfig;
  setConfig: Dispatch<SetStateAction<EntertainmentConfig>>;
}

const MODES: {
  value: EntertainmentMode;
  labelKey: string;
  descKey: string;
  disabled?: boolean;
}[] = [
  {
    value: "dehydrate",
    labelKey: "mode.dehydrate.label",
    descKey: "mode.dehydrate.description",
  },
  {
    value: "interactive",
    labelKey: "mode.interactive.label",
    descKey: "mode.interactive.description",
    // Interactive mode isn't built yet — show it greyed-out and unselectable.
    disabled: true,
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
          className={cn(
            "flex items-start gap-3 rounded-md border p-3 transition-colors",
            opt.disabled ? "opacity-60" : "hover:bg-accent/40",
          )}
        >
          <RadioGroupItem
            value={opt.value}
            id={`ent-mode-${opt.value}`}
            disabled={opt.disabled}
            className="mt-0.5 disabled:opacity-100"
          />
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Label
                htmlFor={`ent-mode-${opt.value}`}
                className={cn(
                  "font-medium",
                  opt.disabled && "cursor-not-allowed",
                )}
              >
                {t(opt.labelKey)}
              </Label>
              {opt.disabled && (
                <Badge variant="secondary" className="font-normal">
                  {t("mode.comingSoon")}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{t(opt.descKey)}</p>
          </div>
        </div>
      ))}
    </RadioGroup>
  );
};
