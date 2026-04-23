import { app } from "electron";
import i18next from "i18next";
import en from "@/locales/en";
import zh from "@/locales/zh";

const SUPPORTED_LANGUAGES = ["en", "zh"];

export function resolveLanguage(pref: string): string {
  if (pref !== "system") return pref;
  const locale = app.getLocale();
  if (locale.startsWith("zh")) return "zh";
  const match = SUPPORTED_LANGUAGES.find((l) => locale.startsWith(l));
  return match ?? "en";
}

const i18n = i18next.createInstance();

i18n.init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
  keySeparator: ".",
});

export { i18n };

export function initI18n(language: string): void {
  i18n.changeLanguage(resolveLanguage(language));
}
