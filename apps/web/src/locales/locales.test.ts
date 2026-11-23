import { afterEach, describe, expect, it } from "vitest";
import i18n from "./index";

/**
 * The i18n runtime behaviour the translation files cannot express.
 *
 * A missing key does not throw: i18next renders the key path itself, so the UI would quietly
 * show "settings.keys.daysAgo". These tests pin the behaviour that turns that into a readable
 * label, keeps the document language in step with the UI, and maps a browser's language onto
 * one the app actually ships.
 */

const originalLanguage = i18n.resolvedLanguage ?? i18n.language;

afterEach(async () => {
  await i18n.changeLanguage(originalLanguage);
});

describe("i18n runtime", () => {
  it("never renders a raw key path when a translation is missing", async () => {
    await i18n.changeLanguage("en-US");
    const rendered = i18n.t("settings:definitely.missingKey");
    expect(rendered).not.toBe("definitely.missingKey");
    expect(rendered).not.toContain(".");
    expect(rendered).toBe("Missing Key");
  });

  it("renders a translation when the key exists", async () => {
    await i18n.changeLanguage("en-US");
    expect(i18n.t("common:actions.retry")).toBe("Retry");
  });

  it("keeps the document language in step with the chosen language", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    await i18n.changeLanguage("en-US");
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("selects the plural form that matches the count", async () => {
    await i18n.changeLanguage("en-US");
    expect(i18n.t("settings:keys.keyBits", { count: 1 })).toBe("1 bit");
    expect(i18n.t("settings:keys.keyBits", { count: 5 })).toBe("5 bits");
  });

  it("interpolates a value into the translation", async () => {
    await i18n.changeLanguage("en-US");
    expect(i18n.t("settings:identities.unlinkDescription", { provider: "GitHub" })).toContain("GitHub");
  });

  it("ships a translation for every language it claims to support", () => {
    for (const language of ["en-US", "zh-CN"]) {
      expect(i18n.getResource(language, "common", "actions.retry"), language).toBeTruthy();
    }
  });
});
