import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test.describe("Registration Page", () => {
  test("renders registration form with all elements", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/register");

    // Verify page title and form elements
    await expect(page.getByRole("heading", { name: /Create your account/i })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Display name")).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('input[name="confirmPassword"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();

    // Verify login link
    await expect(page.getByText("Already have an account?")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("successful registration redirects to default page", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    // Use return URL to specify a simple destination that doesn't require complex gate setup
    await page.goto("/register?return=/projects");

    // Fill registration form
    await page.locator('input[name="email"]').fill("newuser@example.com");
    await page.locator('input[name="displayName"]').fill("New User");
    await page.locator('input[name="password"]').fill("password123");
    await page.locator('input[name="confirmPassword"]').fill("password123");

    // Submit registration
    await page.getByRole("button", { name: "Create account" }).click();

    // Verify successful redirect
    await expect(page).toHaveURL(/\/projects/);
  });

  test("password mismatch shows error", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/register");

    await page.locator('input[name="email"]').fill("test@example.com");
    await page.locator('input[name="displayName"]').fill("Test User");
    await page.locator('input[name="password"]').fill("password123");
    await page.locator('input[name="confirmPassword"]').fill("different456");

    await page.getByRole("button", { name: "Create account" }).click();

    // Verify error message
    await expect(page.getByRole("alert")).toContainText(/don't match/i);
  });

  test("short password shows error", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/register");

    await page.locator('input[name="email"]').fill("test@example.com");
    await page.locator('input[name="displayName"]').fill("Test User");
    await page.locator('input[name="password"]').fill("short");
    await page.locator('input[name="confirmPassword"]').fill("short");

    await page.getByRole("button", { name: "Create account" }).click();

    // Verify error message
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("invalid email format shows error", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/register");

    await page.locator('input[name="email"]').fill("invalid-email");
    await page.locator('input[name="displayName"]').fill("Test User");
    await page.locator('input[name="password"]').fill("password123");
    await page.locator('input[name="confirmPassword"]').fill("password123");

    await page.getByRole("button", { name: "Create account" }).click();

    // Verify error message
    await expect(page.getByRole("alert")).toContainText(/Invalid email/i);
  });

  test("existing email shows conflict error", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/register");

    await page.locator('input[name="email"]').fill("existing@example.com");
    await page.locator('input[name="displayName"]').fill("Test User");
    await page.locator('input[name="password"]').fill("password123");
    await page.locator('input[name="confirmPassword"]').fill("password123");

    await page.getByRole("button", { name: "Create account" }).click();

    // Verify error message is displayed (409 conflict from server)
    await expect(page.getByRole("alert")).toBeVisible();
    // Verify still on registration page
    await expect(page).toHaveURL(/\/register/);
  });

  test("password strength indicator updates correctly", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/register");

    const passwordInput = page.locator('input[name="password"]');

    // Input weak password
    await passwordInput.fill("weak");
    await expect(page.locator(".password-strength")).toContainText(/Weak/i);

    // Input medium password
    await passwordInput.fill("Medium12");
    await expect(page.locator(".password-strength")).toContainText(/Medium/i);

    // Input strong password
    await passwordInput.fill("Strong123!@#");
    await expect(page.locator(".password-strength")).toContainText(/Strong/i);
  });

  test("empty fields show validation errors", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/register");

    // Click submit directly
    await page.getByRole("button", { name: "Create account" }).click();

    // Verify error message displays
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("navigation to login page works", async ({ page }) => {
    await installApiMocks(page, { signedOut: true });
    await page.goto("/register");

    await page.getByRole("link", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/login/);
  });

  test("authenticated user visiting register page redirects away", async ({ page }) => {
    await installApiMocks(page); // Default logged in
    await page.goto("/register");

    // Verify auto redirect
    await expect(page).not.toHaveURL(/\/register/);
  });
});
