import i18next from "i18next";
import en from "@/locales/en";
import zh from "@/locales/zh";

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
  i18n.changeLanguage(language);
}
