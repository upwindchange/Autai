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
  cream: { background: "#fbf5ea", text: "#4a4034" },
  sepia: { background: "#f4ecd8", text: "#5b4636" },
  gray: { background: "#ececed", text: "#2a2a2e" },
  green: { background: "#c7edcc", text: "#1f3d2b" },
  teal: { background: "#d3eef0", text: "#143640" },
  rose: { background: "#f6e1e4", text: "#54303a" },
  night: { background: "#1a1a1a", text: "#c8c8ce" },
  midnight: { background: "#141d2e", text: "#c6cfdd" },
  black: { background: "#000000", text: "#cccccc" },
};

/** Themes in display order, with a swatch color for the segmented control. */
export const READER_THEMES: { value: ReaderTheme; swatch: string }[] = [
  { value: "auto", swatch: THEME_COLORS.auto.background },
  { value: "day", swatch: THEME_COLORS.day.background },
  { value: "cream", swatch: THEME_COLORS.cream.background },
  { value: "sepia", swatch: THEME_COLORS.sepia.background },
  { value: "gray", swatch: THEME_COLORS.gray.background },
  { value: "green", swatch: THEME_COLORS.green.background },
  { value: "teal", swatch: THEME_COLORS.teal.background },
  { value: "rose", swatch: THEME_COLORS.rose.background },
  { value: "night", swatch: THEME_COLORS.night.background },
  { value: "midnight", swatch: THEME_COLORS.midnight.background },
  { value: "black", swatch: THEME_COLORS.black.background },
];

/**
 * Builds the CSS custom properties that drive the entertainment reader. Apply
 * on ThreadPrimitive.Root (entertainment-thread.tsx); they cascade into every
 * `.novel-reader`'s plain-text paragraphs. A custom color
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
    ["--reader-indent" as string]:
      settings.indent ? `${settings.indentAmount}em` : "0",
    ["--reader-text-align" as string]: settings.textAlign,
    ["--reader-font-weight" as string]: String(settings.fontWeight),
    // Side padding for the prose column; consumed by the entertainment thread's
    // padded prose container (entertainment-thread.tsx). Text fills the rest.
    ["--reader-margin" as string]: `${settings.margin}rem`,
  };
}
