import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ReaderTheme =
  | "auto"
  | "day"
  | "cream"
  | "sepia"
  | "gray"
  | "green"
  | "teal"
  | "rose"
  | "night"
  | "midnight"
  | "black";
export type ReaderTextAlign = "left" | "justify";

/**
 * Reader display preferences for entertainment mode. These drive CSS variables
 * on the entertainment thread root (see reader-theme.ts → buildReaderCssVars),
 * which cascade into every `.ent-novel-reader` / Streamdown render.
 */
export interface ReaderSettings {
  /** Background + text color preset. "auto" follows the app light/dark theme. */
  theme: ReaderTheme;
  /** Hex color overriding the theme background; null → use the theme preset. */
  background: string | null;
  /** Hex color overriding the theme text color; null → use the theme preset. */
  textColor: string | null;
  fontSize: number; // px, 14–28
  lineHeight: number; // 1.2–2.4
  letterSpacing: number; // em, -0.05–0.15
  paragraphSpacing: number; // em, 0–2.5
  indent: boolean;
  indentAmount: number; // em, 0–4
  textAlign: ReaderTextAlign;
  margin: number; // rem, 0–40 — side padding; text fills the rest
  fontWeight: 300 | 400 | 500 | 600;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "auto",
  background: null,
  textColor: null,
  fontSize: 17,
  lineHeight: 1.9,
  letterSpacing: 0,
  paragraphSpacing: 0.85,
  indent: true,
  indentAmount: 2,
  textAlign: "left",
  margin: 12,
  fontWeight: 400,
};

interface ReaderSettingsState {
  settings: ReaderSettings;
  setSetting: <K extends keyof ReaderSettings>(
    key: K,
    value: ReaderSettings[K],
  ) => void;
  update: (patch: Partial<ReaderSettings>) => void;
  reset: () => void;
}

/**
 * The one renderer store that uses `persist` → localStorage. Every other store
 * (uiStore, tagStore, …) stays in RAM and round-trips through the backend
 * settings service; reader prefs are local display-only with no cross-device
 * need, so localStorage is the right home and avoids per-slider backend writes.
 */
export const useReaderSettingsStore = create<ReaderSettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_READER_SETTINGS,
      setSetting: (key, value) =>
        set((state) => ({ settings: { ...state.settings, [key]: value } })),
      update: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
      reset: () => set({ settings: DEFAULT_READER_SETTINGS }),
    }),
    {
      name: "autai.reader-settings",
      version: 2,
      // v1 stored maxWidth (a content column width in rem); v2 replaced it with
      // margin (side padding). There's no sensible remap (content width ≠ side
      // margin), so drop the old field and start margin at the default.
      migrate: (persistedState, _version) => {
        const s = persistedState as
          | { settings?: Record<string, unknown> }
          | undefined;
        if (s?.settings) {
          delete s.settings.maxWidth;
          if (s.settings.margin == null) s.settings.margin = 12;
        }
        return persistedState as ReaderSettingsState;
      },
    },
  ),
);

/** Convenience selector returning the whole settings object (stable reference). */
export const useReaderSettings = (): ReaderSettings =>
  useReaderSettingsStore((s) => s.settings);
