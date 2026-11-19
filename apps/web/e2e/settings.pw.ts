import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await installApiMocks(page); // Authenticated user
});

test.describe("Settings Pages", () => {
  test("redirects /settings to /settings/profile", async ({ page }) => {
    await page.goto("/settings");

    // Should redirect to profile by default
    await expect(page).toHaveURL(/\/settings\/profile/);
  });

  test("settings page loads without blank screen", async ({ page }) => {
    await page.goto("/settings/profile");

    // Wait for page to load - use domcontentloaded instead of networkidle
    // as some pages may have polling/background requests
    await page.waitForLoadState("domcontentloaded");

    // Verify topbar exists and is visible
    await expect(page.locator('[role="banner"], header').first()).toBeVisible({ timeout: 10000 });

    // Verify settings content area is visible
    await expect(page.locator("main, [role='main']")).toBeVisible();
  });

  test("uses FocusedLayout (no main sidebar visible)", async ({ page }) => {
    await page.goto("/settings/profile");

    // Wait for content to be visible
    await expect(page.locator('[role="banner"], header').first()).toBeVisible({ timeout: 10000 });

    // Verify main app sidebar is NOT visible
    // Main sidebar would typically have "Projects", "Overview", etc.
    const mainSidebar = page.getByRole("navigation").filter({ hasText: "Projects" });
    await expect(mainSidebar).not.toBeVisible();
  });

  test("displays settings navigation sidebar with 8 items", async ({ page }) => {
    await page.goto("/settings/profile");

    // Wait for settings navigation to be visible
    await expect(page.getByRole("link", { name: /public profile/i })).toBeVisible({ timeout: 10000 });

    // Verify all 8 settings nav items are visible
    const expectedItems = [
      { name: "Profile", text: /public profile/i },
      { name: "Account", text: /^account$/i },
      { name: "Appearance", text: /appearance/i },
      { name: "Notifications", text: /notifications/i },
      { name: "Authentication", text: /password and authentication|authentication/i },
      { name: "Keys", text: /ssh and gpg keys|keys/i },
      { name: "Sessions", text: /sessions/i },
      { name: "Agents", text: /agent interactions|agents/i }
    ];

    for (const item of expectedItems) {
      const navItem = page.getByRole("link", { name: item.text });
      await expect(navItem).toBeVisible();
    }
  });

  test.describe("Settings Subpages Navigation", () => {
    const subpages = [
      { path: "/settings/profile", name: "Profile", heading: /profile/i },
      { path: "/settings/account", name: "Account", heading: /account/i },
      { path: "/settings/appearance", name: "Appearance", heading: /appearance/i },
      { path: "/settings/notifications", name: "Notifications", heading: /notification/i },
      { path: "/settings/authentication", name: "Authentication", heading: /authentication/i },
      { path: "/settings/keys", name: "Keys", heading: /keys/i },
      { path: "/settings/sessions", name: "Sessions", heading: /session/i },
      { path: "/settings/agents", name: "Agents", heading: /agent/i },
    ];

    for (const subpage of subpages) {
      test(`loads ${subpage.name} page successfully`, async ({ page }) => {
        await page.goto(subpage.path);

        // Verify URL
        await expect(page).toHaveURL(subpage.path);

        // Verify page content is visible (not blank)
        const pageContent = page.locator("main, [role='main']").first();
        await expect(pageContent).toBeVisible({ timeout: 10000 });

        // Verify page has some text content (not just empty container)
        await expect(pageContent).not.toBeEmpty();
      });
    }
  });

  test("navigation between settings pages works", async ({ page }) => {
    await page.goto("/settings/account");

    // Wait for page to load
    await expect(page.getByRole("link", { name: /appearance/i })).toBeVisible({ timeout: 10000 });

    // Click on Appearance
    await page.getByRole("link", { name: /appearance/i }).click();
    await expect(page).toHaveURL(/\/settings\/appearance/);
    await expect(page.locator("main")).toBeVisible();

    // Click on Account
    await page.getByRole("link", { name: /^account$/i }).click();
    await expect(page).toHaveURL(/\/settings\/account/);
    await expect(page.locator("main")).toBeVisible();

    // Click on Keys
    await page.getByRole("link", { name: /ssh and gpg keys|keys/i }).click();
    await expect(page).toHaveURL(/\/settings\/keys/);
    await expect(page.locator("main")).toBeVisible();
  });

  test("user menu displays in topbar with 3 items", async ({ page }) => {
    await page.goto("/settings/account");

    // Wait for page to load
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });

    // The user menu trigger is the avatar button in the topbar (UserMenu Popover)
    await page.locator(".user-menu-trigger").click();

    // Wait for menu to open
    await page.waitForTimeout(500);

    // Verify menu items exist (check for text content in the dropdown)
    const menuContainer = page.getByRole("dialog", { name: "User menu" });
    await expect(menuContainer).toBeVisible({ timeout: 5000 });

    // Check for the three expected menu items by text content
    await expect(page.locator('text=/profile/i').first()).toBeVisible();
    await expect(page.locator('text=/settings/i').first()).toBeVisible();
    await expect(page.locator('text=/sign out/i').first()).toBeVisible();
  });

  test("clicking Settings in user menu navigates to settings", async ({ page }) => {
    // Start from a different page (projects typically loads faster)
    await page.goto("/projects");

    // Wait for page to be interactive
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Open user menu
    const userMenuTrigger = page.locator('button').filter({
      hasText: /Taylor Owner|owner@example|T/i
    }).last();

    await userMenuTrigger.click({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Click Settings link - look for any element with "Settings" text
    await page.locator('text=/^settings$/i').first().click();

    // Should redirect to settings
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
  });

  test("no console errors on settings pages", async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Visit settings pages that load successfully
    const pages = [
      "/settings/account",
      "/settings/appearance",
      "/settings/authentication",
      "/settings/keys",
    ];

    for (const path of pages) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000); // Let any async errors surface
    }

    // Filter out known acceptable errors (like network errors for external resources)
    const criticalErrors = consoleErrors.filter(
      (error) => !error.includes("ERR_NAME_NOT_RESOLVED") &&
                 !error.includes("Failed to load resource") &&
                 !error.includes("net::") // Network-related errors
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test("settings page content area is visible and interactive", async ({ page }) => {
    await page.goto("/settings/account");

    // Verify there's a main content area (not just navigation)
    const contentArea = page.locator("main, [role='main']").first();
    await expect(contentArea).toBeVisible({ timeout: 10000 });

    // Content should have some height (not collapsed)
    const box = await contentArea.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(100);
  });

  test("settings navigation highlights active page", async ({ page }) => {
    await page.goto("/settings/appearance");

    // Wait for page to load
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });

    // Find the Appearance nav link
    const appearanceLink = page.getByRole("link", { name: /appearance/i });
    await expect(appearanceLink).toBeVisible();

    // It should have an active state (aria-current, active class, or similar)
    const hasActiveMark = await appearanceLink.evaluate((el) => {
      return el.getAttribute("aria-current") === "page" ||
             el.classList.contains("active") ||
             el.getAttribute("data-active") === "true" ||
             window.getComputedStyle(el).fontWeight === "700" || // bold
             window.getComputedStyle(el).fontWeight === "600";
    });

    expect(hasActiveMark).toBeTruthy();
  });
});
