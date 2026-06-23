import type { CSSProperties } from "react";
import type { ReaderSettings, ReaderTheme } from "@/stores/readerSettingsStore";

interface ThemeColors {
  /** CSS background — a concrete color, or a var() that follows app theme. */
  background: string;
  text: string;
}

/** Color presets for each reader theme. "auto" delegates to the app tokens so
 * it tracks light/dark mode. */
const THEME_COLORS: Record<ReaderTheme, ThemeColors> = {
  auto: { background: "var(--background)", text: "var(--foreground)" },
  day: { background: "#ffffff", text: "#1c1c1e" },
  sepia: { background: "#f4ecd8", text: "#5b4636" },
  night: { background: "#1a1a1a", text: "#c8c8ce" },
  green: { background: "#c7edcc", text: "#1f3d2b" },
};

/** Themes in display order, with a swatch color for the segmented control. */
export const READER_THEMES: { value: ReaderTheme; swatch: string }[] = [
  { value: "auto", swatch: THEME_COLORS.auto.background },
  { value: "day", swatch: THEME_COLORS.day.background },
  { value: "sepia", swatch: THEME_COLORS.sepia.background },
  { value: "night", swatch: THEME_COLORS.night.background },
  { value: "green", swatch: THEME_COLORS.green.background },
];

/**
 * Builds the CSS custom properties that drive the entertainment reader. Apply
 * on ThreadPrimitive.Root (entertainment-thread.tsx); they cascade into every
 * `.ent-novel-reader` and thus into Streamdown's rendered DOM. A custom color
 * (background/textColor) overrides the theme preset; null falls back to it.
 */
export function buildReaderCssVars(settings: ReaderSettings): CSSProperties {
  const theme = THEME_COLORS[settings.theme];
  const background = settings.background ?? theme.background;
  const textColor = settings.textColor ?? theme.text;

  return {
    ["--reader-background" as string]: background,
    ["--reader-text-color" as string]: textColor,
    ["--reader-font-size" as string]: `${settings.fontSize}px`,
    ["--reader-line-height" as string]: String(settings.lineHeight),
    ["--reader-letter-spacing" as string]: `${settings.letterSpacing}em`,
    ["--reader-paragraph-spacing" as string]: `${settings.paragraphSpacing}em`,
    ["--reader-indent" as string]: settings.indent
      ? `${settings.indentAmount}em`
      : "0",
    ["--reader-text-align" as string]: settings.textAlign,
    ["--reader-font-weight" as string]: String(settings.fontWeight),
    // Reuses the existing token also consumed by the user meta card + novel text.
    ["--reading-max-width" as string]: `${settings.maxWidth}rem`,
  };
}
