import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import commonEn from "@/locales/en/common.json";
import welcomeEn from "@/locales/en/welcome.json";
import settingsEn from "@/locales/en/settings.json";
import aboutEn from "@/locales/en/about.json";
import developmentEn from "@/locales/en/development.json";
import providersEn from "@/locales/en/providers.json";
import threadsEn from "@/locales/en/threads.json";

import commonZh from "@/locales/zh/common.json";
import welcomeZh from "@/locales/zh/welcome.json";
import settingsZh from "@/locales/zh/settings.json";
import aboutZh from "@/locales/zh/about.json";
import developmentZh from "@/locales/zh/development.json";
import providersZh from "@/locales/zh/providers.json";
import threadsZh from "@/locales/zh/threads.json";

const resources = {
  en: {
    common: commonEn,
    welcome: welcomeEn,
    settings: settingsEn,
    about: aboutEn,
    development: developmentEn,
    providers: providersEn,
    threads: threadsEn,
  },
  zh: {
    common: commonZh,
    welcome: welcomeZh,
    settings: settingsZh,
    about: aboutZh,
    development: developmentZh,
    providers: providersZh,
    threads: threadsZh,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  ns: [
    "common",
    "welcome",
    "settings",
    "about",
    "development",
    "providers",
    "threads",
  ],
  interpolation: {
    escapeValue: false, // React already escapes
  },
  keySeparator: false, // Flat keys — dots are literal, not nested paths
  nsSeparator: ":", // Use colon to separate namespace from key in t() calls
});

export default i18n;
