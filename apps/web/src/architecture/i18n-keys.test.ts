import { describe, expect, it } from "vitest";
import type { RouteObject } from "react-router-dom";
import { navigationItems } from "../app/navigation";
import { groupKeyByGroup, routeKeyByLabel } from "../app/navigation-labels";
import { routes } from "../app/routes";
import { errorKeyByStatus } from "../shared/api/errors";
import { capabilities } from "../pages/pipelines/WorkflowEditor";
import { changesetAuditOperations, changesetAuditOutcomes } from "../pages/changesets/changeset-status";
import { pipelineStateKey, pipelineStates } from "../pages/pipelines/pipeline-states";
import { workspaceTranslationKeys } from "../pages/webide/workspace-keys";
import { settingsNavGroups, settingsNavItems } from "../pages/settings/settings-nav";
import {
  collectKeyReferences,
  flattenKeys,
  hasEveryPluralVariant,
  hasKey,
  placeholdersByKey,
  readLocaleFiles,
  shippedLanguages,
  shippedNamespaces,
} from "./i18n-keys";

/**
 * The translation contract.
 *
 * A missing key does not throw: i18next renders the key path itself, so the UI quietly shows
 * "settings.keys.daysAgo" instead of a sentence. Nothing else in the build notices, which is how
 * a hundred keys went missing across two branches that each named the settings keys differently.
 * These checks make that failure loud.
 */

const localeFiles = Object.fromEntries(
  shippedLanguages.map((language) => [language, readLocaleFiles(language)] as const),
);

/** Whether a fully qualified key resolves in every shipped language. */
function resolvesEverywhere(key: string): boolean {
  const separator = key.indexOf(":");
  const namespace = key.slice(0, separator);
  const leaf = key.slice(separator + 1);
  return shippedLanguages.every((language) => hasKey(localeFiles[language][namespace] ?? {}, leaf, language));
}

/** The keys a `t` call asks for, grouped by the file that asks for them. */
function missingTranslations(): string[] {
  const missing: string[] = [];

  for (const reference of collectKeyReferences()) {
    const separator = reference.key.indexOf(":");
    const namespace = reference.key.slice(0, separator);
    const key = reference.key.slice(separator + 1);

    for (const language of shippedLanguages) {
      const tree = localeFiles[language][namespace];
      if (!tree) {
        missing.push(`${reference.key} (no "${namespace}" namespace in ${language}) <- ${reference.file}`);
        continue;
      }
      const present = reference.plural
        ? hasEveryPluralVariant(tree, key, language)
        : hasKey(tree, key, language);
      if (!present) missing.push(`${reference.key} (missing in ${language}) <- ${reference.file}`);
    }
  }

  return [...new Set(missing)].sort();
}

/** The keys one language has and the other does not. */
function languageDrift(): string[] {
  const drift: string[] = [];
  const [first, ...rest] = shippedLanguages;

  for (const namespace of shippedNamespaces()) {
    const firstKeys = new Set(flattenKeys(localeFiles[first][namespace] ?? {}));
    for (const language of rest) {
      const otherKeys = new Set(flattenKeys(localeFiles[language][namespace] ?? {}));
      for (const key of firstKeys) {
        if (!otherKeys.has(key)) drift.push(`${namespace}:${key} is missing in ${language}`);
      }
      for (const key of otherKeys) {
        if (!firstKeys.has(key)) drift.push(`${namespace}:${key} is missing in ${first}`);
      }
    }
  }

  return drift.sort();
}

/** The keys whose `{{placeholder}}` names differ between the shipped languages. */
function placeholderDrift(): string[] {
  const [first, ...rest] = shippedLanguages;
  const firstPlaceholders = placeholdersByKey(first);
  const drift: string[] = [];

  for (const language of rest) {
    for (const [key, placeholders] of placeholdersByKey(language)) {
      const expected = firstPlaceholders.get(key);
      if (!expected) continue;
      if (expected.join(",") !== placeholders.join(",")) {
        drift.push(`${key}: ${first} expects [${expected.join(", ")}] but ${language} has [${placeholders.join(", ")}]`);
      }
    }
  }

  return drift.sort();
}

/** The route labels the shell chrome renders, which the topbar, page header and palette translate. */
function shellRouteLabels(): string[] {
  const labels: string[] = [];
  const joinPath = (base: string, path = "") => `/${base}/${path}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
  const walk = (entries: readonly RouteObject[], parentPath: string) => {
    for (const entry of entries) {
      const path = joinPath(parentPath, entry.path);
      // The settings pages render their own sidebar, so their labels never reach the shell chrome.
      if (entry.handle?.label && !path.startsWith("/settings")) labels.push(entry.handle.label);
      if (entry.children) walk(entry.children, path);
    }
  };
  walk(routes, "");
  return labels;
}

describe("translation resources", () => {
  it("ships a translation for every key the code asks for, in every shipped language", () => {
    expect(missingTranslations()).toEqual([]);
  });

  it("keeps the shipped languages in step key by key", () => {
    expect(languageDrift()).toEqual([]);
  });

  it("keeps the interpolation placeholders of a key identical across languages", () => {
    expect(placeholderDrift()).toEqual([]);
  });
});

describe("navigation translations", () => {
  it("translates every navigation item label", () => {
    for (const item of navigationItems) {
      expect(routeKeyByLabel[item.label], `navigation item "${item.label}"`).toBeDefined();
    }
  });

  it("translates every route label the router declares", () => {
    for (const label of shellRouteLabels()) {
      expect(routeKeyByLabel[label], `route label "${label}"`).toBeDefined();
    }
  });

  it("translates every navigation group", () => {
    for (const item of navigationItems) {
      expect(groupKeyByGroup[item.group], `navigation group "${item.group}"`).toBeDefined();
    }
  });

  it("translates every settings navigation entry", () => {
    const keys = [
      ...settingsNavItems.map((item) => `settings:${item.labelKey}`),
      ...settingsNavGroups.flatMap((group) => [
        `settings:${group.titleKey}`,
        ...group.items.map((item) => `settings:${item.labelKey}`),
      ]),
    ];
    for (const key of keys) {
      expect(resolvesEverywhere(key), key).toBe(true);
    }
  });

  it("resolves every navigation label, group and description in every shipped language", () => {
    const unresolved: string[] = [];
    const keys = [
      ...Object.values(routeKeyByLabel),
      ...Object.values(groupKeyByGroup),
      ...navigationItems.map((item) => item.descriptionKey).filter((key) => key !== undefined),
    ];
    for (const key of keys) {
      if (!resolvesEverywhere(key)) unresolved.push(key);
    }
    expect(unresolved.sort()).toEqual([]);
  });
});

describe("dynamic translation keys", () => {
  it("translates every pipeline state", () => {
    for (const state of pipelineStates) {
      expect(resolvesEverywhere(`pipelines:${pipelineStateKey(state)}`), `pipeline state "${state}"`).toBe(true);
    }
  });

  it("translates every pipeline capability label", () => {
    for (const capability of capabilities) {
      expect(resolvesEverywhere(`pipelines:${capability.label}`), `pipeline capability "${capability.label}"`).toBe(true);
    }
  });

  it("translates every workspace state, file source and diff classification", () => {
    for (const key of workspaceTranslationKeys) {
      expect(resolvesEverywhere(`repositories:${key}`), `workspace key "${key}"`).toBe(true);
    }
  });

  it("translates every audit operation and outcome", () => {
    for (const operation of changesetAuditOperations) {
      expect(resolvesEverywhere(`changesets:audit.operations.${operation.replace(".", "_")}`), operation).toBe(true);
    }
    for (const outcome of changesetAuditOutcomes) {
      expect(resolvesEverywhere(`changesets:audit.outcomes.${outcome}`), outcome).toBe(true);
    }
  });

  it("translates every API failure status", () => {
    for (const key of Object.values(errorKeyByStatus)) {
      expect(resolvesEverywhere(key), key).toBe(true);
    }
    expect(resolvesEverywhere("errors:unknown")).toBe(true);
  });
});
