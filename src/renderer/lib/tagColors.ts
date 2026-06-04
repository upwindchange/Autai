import type { CSSProperties } from "react";

/**
 * 16 curated hex colors from ColorBrewer qualitative scales (Paired + Dark2).
 * Designed for maximum perceptual distinctness and accessibility as badge backgrounds.
 */
export const TAG_PALETTE = [
  "#4E79A7",
  "#F28E2B",
  "#E15759",
  "#76B7B2",
  "#59A14F",
  "#EDC948",
  "#B07AA1",
  "#FF9DA7",
  "#9C755F",
  "#BAB0AC",
  "#1B9E77",
  "#D95F02",
  "#7570B3",
  "#E7298A",
  "#66A61E",
  "#E6AB02",
] as const;

/**
 * Pick a random color from the palette.
 * Used when creating a new tag without specifying a color.
 */
export function getRandomPaletteColor(): string {
  return TAG_PALETTE[Math.floor(Math.random() * TAG_PALETTE.length)]!;
}

/**
 * Compute the relative luminance of an RGB color per WCAG 2.0.
 */
function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Returns a text color that ensures readable contrast over the given hex background.
 * Uses WCAG relative luminance to pick dark (`#1A1A2E`) or white (`#FFFFFF`) text.
 */
export function getContrastTextColor(bgHex: string): string {
  const clean = bgHex.replace("#", "");
  const num = parseInt(clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return relativeLuminance(r, g, b) > 0.45 ? "#1A1A2E" : "#FFFFFF";
}

/**
 * Returns inline style and className for a tag chip based on its stored color.
 * If color is null/empty (legacy DB data), falls back to muted default style.
 */
export function getTagChipStyle(
  color: string | null | undefined,
): { style: CSSProperties; className: string } {
  if (!color) {
    return { style: {}, className: "bg-muted text-muted-foreground" };
  }
  return {
    style: {
      backgroundColor: color,
      color: getContrastTextColor(color),
    },
    className: "",
  };
}
