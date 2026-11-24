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
import enErrors from "./en-US/errors.json";
import enPulls from "./en-US/pulls.json";
import enProjectFields from "./en-US/projectFields.json";
import enApp from "./en-US/app.json";

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
import zhErrors from "./zh-CN/errors.json";
import zhPulls from "./zh-CN/pulls.json";
import zhProjectFields from "./zh-CN/projectFields.json";
import zhApp from "./zh-CN/app.json";

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
    errors: enErrors,
    app: enApp,
    pulls: enPulls,
    projectFields: enProjectFields,
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
    errors: zhErrors,
    app: zhApp,
    pulls: zhPulls,
    projectFields: zhProjectFields,
  },
};

/** The only languages the app ships translations for. */
const supportedLanguages = ["en-US", "zh-CN"] as const;

/**
 * Maps a detected language onto one the app ships.
 *
 * Browsers report "zh", "zh-Hans" or "zh-SG" for the same language, and only "zh-CN" has
 * translations here. `supportedLngs` cannot do this: with `nonExplicitSupportedLngs` it compares
 * only the language part, which would reject "en-US" itself and empty the resolve hierarchy.
 */
function toShippedLanguage(detected: string): string {
  const language = detected.toLowerCase();
  if (language.startsWith("zh")) return "zh-CN";
  if (language.startsWith("en")) return "en-US";
  // Anything else falls back to the first shipped language.
  return supportedLanguages[0];
}

/**
 * A missing key renders as its own path ("settings.keys.daysAgo"), which is unreadable in the UI.
 * i18next ignores whatever `missingKeyHandler` returns, so the readable fallback is applied by
 * wrapping `t` instead: every component goes through `getFixedT`, which delegates to `i18n.t`.
 */
function readableMissingKey(key: string): string {
  const leaf = key.split(/[.:]/).pop() ?? key;
  const words = leaf
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Keeps `<html lang>` in step with the UI so assistive technology and `Intl` follow the chosen language. */
function syncDocumentLanguage(language: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en-US",
    defaultNS: "common",
    ns: ["common", "navigation", "changesets", "login", "register", "settings", "organization", "repositories", "overview", "pipelines", "errors", "app", "projectFields"],
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "agentforge-language",
      convertDetectedLanguage: toShippedLanguage,
    },
    missingKeyHandler: (language, namespace, key) => {
      console.error(`[i18n] Missing translation "${namespace}:${key}" for language "${language}".`);
    },
  });

/** Replaces the raw key path with a readable label so a missing translation never reaches the UI. */
const translate = i18n.t.bind(i18n) as unknown as (...args: unknown[]) => unknown;
i18n.t = ((key: unknown, ...rest: unknown[]) => {
  const value = translate(key, ...rest);
  if (typeof key !== "string") return value;
  // i18next returns the key without its namespace when the lookup fails.
  const separator = key.indexOf(":");
  const bareKey = separator > -1 ? key.slice(separator + 1) : key;
  if (value !== key && value !== bareKey) return value;
  return readableMissingKey(bareKey);
}) as unknown as typeof i18n.t;

i18n.on("languageChanged", syncDocumentLanguage);
syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language);

export default i18n;
