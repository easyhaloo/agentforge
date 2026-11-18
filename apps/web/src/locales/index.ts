import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enCommon from "./en-US/common.json";
import enNavigation from "./en-US/navigation.json";
import enChangesets from "./en-US/changesets.json";
import zhCommon from "./zh-CN/common.json";
import zhNavigation from "./zh-CN/navigation.json";
import zhChangesets from "./zh-CN/changesets.json";

import enPipelines from "./en-US/pipelines.json";
import zhPipelines from "./zh-CN/pipelines.json";

const resources = {
  "en-US": {
    pipelines: enPipelines,
    common: enCommon,
    navigation: enNavigation,
    changesets: enChangesets,
  },
  "zh-CN": {
    pipelines: zhPipelines,
    common: zhCommon,
    navigation: zhNavigation,
    changesets: zhChangesets,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en-US",
    defaultNS: "common",
    ns: ["common", "navigation", "changesets", "pipelines"],
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "agentforge-language",
    },
  });

export default i18n;
