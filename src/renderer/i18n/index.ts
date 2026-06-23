import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import commonEn from "@/locales/en/common.json";
import settingsEn from "@/locales/en/settings.json";
import aboutEn from "@/locales/en/about.json";
import developmentEn from "@/locales/en/development.json";
import providersEn from "@/locales/en/providers.json";
import threadsEn from "@/locales/en/threads.json";
import mcpServersEn from "@/locales/en/mcp-servers.json";
import readerEn from "@/locales/en/reader.json";

import commonZh from "@/locales/zh/common.json";
import settingsZh from "@/locales/zh/settings.json";
import aboutZh from "@/locales/zh/about.json";
import developmentZh from "@/locales/zh/development.json";
import providersZh from "@/locales/zh/providers.json";
import threadsZh from "@/locales/zh/threads.json";
import mcpServersZh from "@/locales/zh/mcp-servers.json";
import readerZh from "@/locales/zh/reader.json";

const resources = {
  en: {
    common: commonEn,
    settings: settingsEn,
    about: aboutEn,
    development: developmentEn,
    providers: providersEn,
    threads: threadsEn,
    "mcp-servers": mcpServersEn,
    reader: readerEn,
  },
  zh: {
    common: commonZh,
    settings: settingsZh,
    about: aboutZh,
    development: developmentZh,
    providers: providersZh,
    threads: threadsZh,
    "mcp-servers": mcpServersZh,
    reader: readerZh,
  },
};

const SUPPORTED_LANGUAGES = ["en", "zh"];

export function resolveLanguage(pref: string): string {
  if (pref !== "system") return pref;
  const locale = navigator.language;
  if (locale.startsWith("zh")) return "zh";
  const match = SUPPORTED_LANGUAGES.find((l) => locale.startsWith(l));
  return match ?? "en";
}

i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  ns: [
    "common",
    "settings",
    "about",
    "development",
    "providers",
    "threads",
    "mcp-servers",
    "reader",
  ],
  interpolation: {
    escapeValue: false, // React already escapes
  },
  keySeparator: false, // Flat keys — dots are literal, not nested paths
  nsSeparator: ":", // Use colon to separate namespace from key in t() calls
});

export default i18n;
