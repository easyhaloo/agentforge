import type { Locator, Page } from "@playwright/test";

/**
 * Selects an option in the custom af-select combobox (a button trigger that
 * opens a listbox of role="option" buttons). The trigger is not a native
 * <select>, so Playwright's locator.selectOption() cannot be used.
 *
 * Options match on their label span: the option button may also contain a
 * "✓" check mark for the currently selected entry, which would break exact
 * text matching on the button itself.
 */
export async function selectOption(page: Page, comboboxLocator: Locator, option: string | RegExp): Promise<void> {
  await comboboxLocator.click();
  const matcher =
    option instanceof RegExp
      ? { hasText: option }
      : { hasText: new RegExp(`^${String(option).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) };
  const optionLabel = page.locator(".af-select-option > span").filter(matcher).first();
  await optionLabel.click();
}
