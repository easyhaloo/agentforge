import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enCommon from "./en-US/common.json";
import enNavigation from "./en-US/navigation.json";
import enChangesets from "./en-US/changesets.json";
import enLogin from "./en-US/login.json";
import enRegister from "./en-US/register.json";
import enSettings from "./en-US/settings.json";
import enOrganization from "./en-US/organization.json";
import enRepositories from "./en-US/repositories.json";
import enOverview from "./en-US/overview.json";
import enPipelines from "./en-US/pipelines.json";

import zhCommon from "./zh-CN/common.json";
import zhNavigation from "./zh-CN/navigation.json";
import zhChangesets from "./zh-CN/changesets.json";
import zhLogin from "./zh-CN/login.json";
import zhRegister from "./zh-CN/register.json";
import zhSettings from "./zh-CN/settings.json";
import zhOrganization from "./zh-CN/organization.json";
import zhRepositories from "./zh-CN/repositories.json";
import zhOverview from "./zh-CN/overview.json";
import zhPipelines from "./zh-CN/pipelines.json";

const resources = {
  "en-US": {
    common: enCommon,
    navigation: enNavigation,
    changesets: enChangesets,
    login: enLogin,
    register: enRegister,
    settings: enSettings,
    organization: enOrganization,
    repositories: enRepositories,
    overview: enOverview,
    pipelines: enPipelines,
  },
  "zh-CN": {
    common: zhCommon,
    navigation: zhNavigation,
    changesets: zhChangesets,
    login: zhLogin,
    register: zhRegister,
    settings: zhSettings,
    organization: zhOrganization,
    repositories: zhRepositories,
    overview: zhOverview,
    pipelines: zhPipelines,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en-US",
    defaultNS: "common",
    ns: ["common", "navigation", "changesets", "login", "register", "settings", "organization", "repositories", "overview", "pipelines"],
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
