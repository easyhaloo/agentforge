import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e-harness.html");
});

test("modal traps focus, closes with Escape, and restores the opener", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open modal" });
  await opener.click();

  const dialog = page.getByRole("dialog", { name: "Browser test modal" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeFocused();

  await page.getByTestId("outside-focus-target").evaluate((element: HTMLElement) => element.focus());
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("modal closes on backdrop click", async ({ page }) => {
  await page.getByRole("button", { name: "Open modal" }).click();
  await expect(page.getByRole("dialog", { name: "Browser test modal" })).toBeVisible();
  await page.locator(".af-modal-backdrop").click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("dialog", { name: "Browser test modal" })).toBeHidden();
});

test("drawer traps focus and closes with Escape", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open drawer" });
  await opener.click();
  const drawer = page.getByRole("dialog", { name: "Browser test drawer" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Browser test drawer" })).toBeVisible();

  // Wait for drawer to be fully visible (animation class applied)
  await expect(drawer).toHaveClass(/af-drawer--visible/);

  await page.getByTestId("outside-focus-target").evaluate((element: HTMLElement) => element.focus());
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("button", { name: "Drawer action" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
});

test("popover closes with Escape and restores trigger focus", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Open popover" });
  await trigger.click();
  const popover = page.getByRole("dialog", { name: "Browser test popover" });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole("button", { name: "Popover action" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("tabs support arrow-key navigation and update the selected tab", async ({ page }) => {
  const overview = page.getByRole("tab", { name: "Overview" });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Activity" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("active-tab")).toHaveText("Active tab: activity");
});

test("command palette filters destinations and navigates on selection", async ({ page }) => {
  const location = page.getByTestId("navigation-result");
  await expect(location).toHaveText("Location: /harness");
  await page.getByRole("button", { name: "Open command palette" }).click();
  const dialog = page.getByRole("dialog", { name: "Jump to a page" });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("textbox", { name: "Search pages" });
  await search.fill("Overview");
  const result = dialog.getByRole("button", { name: /Overview/ }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(dialog).toBeHidden();
  await expect(location).toHaveText("Location: /");

  // Outside the application shell there is no selected organization, so organization pages use the `current` alias.
  await page.getByRole("button", { name: "Open command palette" }).click();
  await search.fill("Changesets");
  await dialog.getByRole("button", { name: /Changesets/ }).click();
  await expect(dialog).toBeHidden();
  await expect(location).toHaveText("Location: /orgs/current/changesets");
});

test("drawer slides in with animation when opened", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open drawer" });
  const drawer = page.getByRole("dialog", { name: "Browser test drawer" });

  // Drawer should not be visible initially
  await expect(drawer).toBeHidden();

  // Open the drawer
  await opener.click();

  // Drawer should become visible but start with transform (off-screen)
  await expect(drawer).toBeVisible();

  // Check that drawer has the animation class applied
  await expect(drawer).toHaveClass(/af-drawer--visible/);

  // Wait for animation to complete (300ms + buffer)
  await page.waitForTimeout(400);

  // Drawer should be fully visible with no transform offset
  const transform = await drawer.evaluate((el) => getComputedStyle(el).transform);
  // Transform should be 'none' or 'matrix(1, 0, 0, 1, 0, 0)' when fully visible
  expect(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)').toBeTruthy();
});

test("drawer slides out with animation when closed", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open drawer" });
  const drawer = page.getByRole("dialog", { name: "Browser test drawer" });

  // Open drawer and wait for animation
  await opener.click();
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(400);

  // Close the drawer
  await page.keyboard.press("Escape");

  // Drawer should still be visible briefly during exit animation
  await expect(drawer).toBeVisible();

  // After a short delay, drawer should still be animating
  await page.waitForTimeout(100);
  await expect(drawer).toBeVisible();

  // After full animation duration (350ms), drawer should be hidden
  await page.waitForTimeout(300);
  await expect(drawer).toBeHidden();
});

test("drawer backdrop fades in and out with animation", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open drawer" });
  const backdrop = page.locator(".af-drawer-backdrop");

  // Open drawer
  await opener.click();
  await expect(backdrop).toBeVisible();

  // Backdrop should have visible class for animation
  await expect(backdrop).toHaveClass(/af-drawer-backdrop--visible/);

  // Wait for fade-in animation
  await page.waitForTimeout(350);

  // Check backdrop opacity is near 1
  const opacity = await backdrop.evaluate((el) => getComputedStyle(el).opacity);
  expect(parseFloat(opacity)).toBeGreaterThan(0.9);

  // Close drawer
  await page.keyboard.press("Escape");

  // Wait for fade-out animation to complete
  await page.waitForTimeout(400);
  await expect(backdrop).toBeHidden();
});

test("a closing drawer stops taking clicks on the page behind it", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open drawer" });
  await opener.click();
  await expect(page.getByRole("dialog", { name: "Browser test drawer" })).toBeVisible();

  await page.keyboard.press("Escape");

  // The drawer stays on screen while it fades out, but it must not swallow the clicks of the page behind it.
  const backdrop = page.locator(".af-drawer-backdrop");
  await expect(backdrop).toHaveAttribute("inert", "");
  await expect(backdrop).toHaveCSS("pointer-events", "none");

  // The click lands on the page behind while the drawer is still mounted.
  await page.getByTestId("outside-focus-target").click();
  await expect(page.locator(".af-drawer")).toHaveCount(1);
});

test("drawer respects prefers-reduced-motion", async ({ page }) => {
  // Set reduced motion preference using Playwright's emulateMedia
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // Navigate to page with reduced motion setting
  await page.goto("/e2e-harness.html");

  const opener = page.getByRole("button", { name: "Open drawer" });
  const drawer = page.getByRole("dialog", { name: "Browser test drawer" });

  // Open drawer
  await opener.click();
  await expect(drawer).toBeVisible();

  // With reduced motion, drawer should appear without animation
  // The transition property should be 'none' or contain '0s' when disabled by media query
  const transition = await drawer.evaluate((el) => {
    const style = getComputedStyle(el);
    return style.transition;
  });

  // Check if transition is effectively disabled (contains 'none' or all durations are 0s)
  const hasNoTransition = transition === 'none' ||
                          transition === 'all 0s ease 0s' ||
                          !transition.match(/[0-9.]+[a-z]+(?!.*0s)/); // No non-zero duration

  expect(hasNoTransition).toBeTruthy();
});
