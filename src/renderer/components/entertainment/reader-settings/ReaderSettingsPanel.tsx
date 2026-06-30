import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  DEFAULT_READER_SETTINGS,
  useReaderSettingsStore,
  type ReaderSettings,
  type ReaderTextAlign,
} from "@/stores/readerSettingsStore";
import { READER_THEMES } from "./reader-theme";

/**
 * Body of the reader-settings popover — conventional reader controls (Kindle /
 * Apple Books style). Every control writes straight to readerSettingsStore; the
 * live reading surface reacts because the store feeds CSS vars on the thread
 * root (see buildReaderCssVars).
 */
export const ReaderSettingsPanel = () => {
  const { t } = useTranslation("reader");
  const settings = useReaderSettingsStore((s) => s.settings);
  const setSetting = useReaderSettingsStore((s) => s.setSetting);
  const reset = useReaderSettingsStore((s) => s.reset);

  return (
    <div className="flex flex-col gap-4">
      {/* Theme swatches */}
      <Field label={t("reader.theme.label")}>
        <div className="flex flex-wrap items-center gap-2">
          {READER_THEMES.map((th) => (
            <button
              key={th.value}
              type="button"
              onClick={() => setSetting("theme", th.value)}
              title={t(`reader.theme.${th.value}`)}
              aria-label={t(`reader.theme.${th.value}`)}
              aria-pressed={settings.theme === th.value}
              className={cn(
                "size-7 shrink-0 rounded-full border-2 transition",
                settings.theme === th.value ?
                  "border-primary ring-2 ring-primary/30"
                : "border-border hover:border-foreground/40",
              )}
              style={{ backgroundColor: th.swatch }}
            />
          ))}
        </div>
      </Field>

      {/* Custom background / text color overrides */}
      <Field label={t("reader.color.label")}>
        <div className="grid grid-cols-2 gap-2">
          <ColorField
            label={t("reader.color.background")}
            value={settings.background}
            onChange={(v) => setSetting("background", v)}
            onClear={() => setSetting("background", null)}
            clearLabel={t("reader.color.clear")}
          />
          <ColorField
            label={t("reader.color.text")}
            value={settings.textColor}
            onChange={(v) => setSetting("textColor", v)}
            onClear={() => setSetting("textColor", null)}
            clearLabel={t("reader.color.clear")}
          />
        </div>
      </Field>

      <Divider />

      {/* Typography */}
      <SectionLabel>{t("reader.typography.label")}</SectionLabel>
      <SliderRow
        label={t("reader.fontSize.label")}
        value={settings.fontSize}
        min={14}
        max={28}
        step={1}
        onChange={(v) => setSetting("fontSize", v)}
      />
      <SliderRow
        label={t("reader.lineHeight.label")}
        value={settings.lineHeight}
        min={1.2}
        max={2.4}
        step={0.05}
        format={(v) => `${v.toFixed(2)}`}
        onChange={(v) => setSetting("lineHeight", v)}
      />
      <SliderRow
        label={t("reader.letterSpacing.label")}
        value={settings.letterSpacing}
        min={-0.05}
        max={0.15}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(v) => setSetting("letterSpacing", v)}
      />
      <SliderRow
        label={t("reader.paragraphSpacing.label")}
        value={settings.paragraphSpacing}
        min={0}
        max={2.5}
        step={0.05}
        format={(v) => v.toFixed(2)}
        onChange={(v) => setSetting("paragraphSpacing", v)}
      />

      <Field label={t("reader.fontWeight.label")}>
        <Select
          value={String(settings.fontWeight)}
          onValueChange={(v) =>
            setSetting("fontWeight", Number(v) as ReaderSettings["fontWeight"])
          }
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {([300, 400, 500, 600] as const).map((w) => (
              <SelectItem key={w} value={String(w)}>
                {t(`reader.weight.${w}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Divider />

      {/* Layout */}
      <SectionLabel>{t("reader.layout.label")}</SectionLabel>
      <SliderRow
        label={t("reader.margin.label")}
        value={settings.margin}
        min={0}
        max={40}
        step={0.5}
        format={(v) => `${v}rem`}
        onChange={(v) => setSetting("margin", v)}
      />
      <Field label={t("reader.textAlign.label")}>
        <div className="grid grid-cols-2 gap-1.5">
          {(["left", "justify"] as const).map((a) => (
            <Button
              key={a}
              type="button"
              variant={settings.textAlign === a ? "default" : "outline"}
              size="xs"
              onClick={() =>
                setSetting("textAlign", a satisfies ReaderTextAlign)
              }
            >
              {t(`reader.textAlign.${a}`)}
            </Button>
          ))}
        </div>
      </Field>
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">
          {t("reader.indent.label")}
        </Label>
        <Switch
          checked={settings.indent}
          onCheckedChange={(v) => setSetting("indent", v)}
        />
      </div>
      <SliderRow
        label={t("reader.indentAmount.label")}
        value={settings.indentAmount}
        min={0}
        max={4}
        step={0.5}
        disabled={!settings.indent}
        format={(v) => v.toFixed(1)}
        onChange={(v) => setSetting("indentAmount", v)}
      />

      <Divider />

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={reset}
        disabled={
          JSON.stringify(settings) === JSON.stringify(DEFAULT_READER_SETTINGS)
        }
      >
        <RotateCcw />
        {t("reader.reset")}
      </Button>
    </div>
  );
};

// --- small layout helpers ---------------------------------------------------

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-border" />;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  format,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  format?: (v: number) => string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {format ? format(value) : `${value}${unit ?? ""}`}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(v[0] ?? value)}
      />
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
  onClear,
  clearLabel,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  onClear: () => void;
  clearLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {value ?
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            {clearLabel}
          </button>
        : null}
      </div>
      <input
        type="color"
        // When null, show a neutral default; the effective color still comes
        // from the theme preset until the user picks one.
        value={value ?? "#ffffff"}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-full cursor-pointer rounded border border-input bg-transparent p-0"
      />
    </div>
  );
}
