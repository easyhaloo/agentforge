import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test.describe("Login Page", () => {
  test("renders login form with all elements", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/login");

    // Verify page title and form elements
    await expect(page.getByRole("heading", { name: "Sign in to AgentForge" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // Verify registration link
    await expect(page.getByText("Don't have an account?")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up", exact: true })).toBeVisible();
  });

  test("the login background respects reduced motion and fits a narrow viewport", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/login");

    const login = page.getByRole("main", { name: "Sign in to AgentForge" });
    const animationName = () => login.evaluate(element => getComputedStyle(element, "::before").animationName);
    expect(await animationName()).toBe("login-ambient-in");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(animationName).toBe("none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page.locator('input[name="password"]')).toHaveAttribute("type", "text");
  });

  test("successful login redirects to default page", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    // Use return URL to specify a simple destination that doesn't require complex gate setup
    await page.goto("/login?return=/projects");

    // Fill login form
    await page.locator('input[name="email"]').fill("test@example.com");
    await page.locator('input[name="password"]').fill("password123");

    // Click login
    await page.getByRole("button", { name: "Sign in" }).click();

    // Verify successful redirect
    await expect(page).toHaveURL(/\/projects/);
  });

  test("successful login with return URL redirects correctly", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/login?return=/projects");

    await page.locator('input[name="email"]').fill("test@example.com");
    await page.locator('input[name="password"]').fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Verify redirect to return URL
    await expect(page).toHaveURL(/\/projects/);
  });

  test("login failure shows error message", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/login");

    await page.locator('input[name="email"]').fill("wrong@example.com");
    await page.locator('input[name="password"]').fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Verify error message displays
    await expect(page.getByRole("alert")).toContainText(/Invalid/i);

    // Verify still on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test("empty email shows validation error", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/login");

    await page.locator('input[name="password"]').fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Verify error message
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("empty password shows validation error", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/login");

    await page.locator('input[name="email"]').fill("test@example.com");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Verify error message
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("authenticated user visiting login page redirects away", async ({ page }) => {
    await installApiMocks(page); // Default logged in
    await page.goto("/login");

    // Verify auto redirect away from login page
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("navigation to registration page works", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/login");

    await page.getByRole("link", { name: "Sign up", exact: true }).click();

    await expect(page).toHaveURL(/\/register/);
  });
});
