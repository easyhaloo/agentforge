import { expect, test, type Page } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";

const google = { id: "google", login_url: "/auth/google/login" };
const github = { id: "github", login_url: "/auth/github/login" };
const oidc = { id: "oidc", login_url: "/auth/oidc/login" };
const providerLinks = (page: Page) => page.getByRole("link", { name: /^(Continue with (Google|GitHub)|SSO|Sign up with SSO)$/ });

test("named SSO links stay in order and preserve a deep link after a callback error", async ({ page }) => {
  await installApiMocks(page, { signedOut: true });
  await page.route("**/auth/providers", (route) => route.fulfill({ json: { providers: [google, github, oidc] } }));
  await page.setViewportSize({ width: 320, height: 640 });

  const destination = "/orgs/demo/changesets?filter=open#list";
  const returnQuery = new URLSearchParams({ return: destination });
  const googleEntry = `/auth/google/login?${returnQuery}`;
  const callbackErrorQuery = new URLSearchParams({ sso_error: "cancelled", return: destination });
  await page.route((url) => url.pathname === google.login_url, (route) => {
    expect(new URL(route.request().url()).searchParams.get("return")).toBe(destination);
    expect(route.request().isNavigationRequest()).toBe(true);
    return route.fulfill({ status: 303, headers: { Location: `/login?${callbackErrorQuery}` } });
  });

  await page.goto(`/login?${returnQuery}`);
  await expect(providerLinks(page)).toHaveText(["Continue with Google", "Continue with GitHub", "SSO"]);
  const googleLink = page.getByRole("link", { name: "Continue with Google" });
  await expect(googleLink).toHaveAttribute("href", googleEntry);
  await expect(page.getByRole("link", { name: "Continue with GitHub" })).toHaveAttribute("href", `/auth/github/login?${returnQuery}`);
  await expect(page.getByRole("link", { name: "SSO", exact: true })).toHaveAttribute("href", oidc.login_url);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  await page.getByRole("button", { name: "Sign in", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(googleLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText(/Single sign-on was cancelled/);
  await expect(googleLink).toHaveAttribute("href", googleEntry);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});

test("registration shows only enabled providers and passes only a local return path", async ({ page }) => {
  await installApiMocks(page, { signedOut: true });
  await page.route("**/auth/providers", (route) => route.fulfill({ json: { providers: [github] } }));

  const returnQuery = new URLSearchParams({ return: "/projects?filter=open#list" });
  await page.goto(`/register?${returnQuery}`);
  await expect(providerLinks(page)).toHaveText(["Continue with GitHub"]);
  await expect(providerLinks(page)).toHaveAttribute("href", `/auth/github/login?${returnQuery}`);
  await expect(page.getByText("or sign up with")).toBeVisible();

  await page.goto("/register?return=%2F%2Fexample.invalid");
  await expect(providerLinks(page)).toHaveAttribute("href", github.login_url);
});

test("while providers load and when none are configured, password login remains available", async ({ page }) => {
  await installApiMocks(page, { signedOut: true });
  let finishDiscovery: () => void = () => {};
  const releaseDiscovery = new Promise<void>((resolve) => { finishDiscovery = resolve; });
  await page.route("**/auth/providers", async (route) => {
    await releaseDiscovery;
    await route.fulfill({ json: { providers: [] } });
  });
  const discoveryResponse = page.waitForResponse("**/auth/providers");
  await page.goto("/login?return=/projects");
  try {
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
    await expect(page.getByText("or sign in with")).toHaveCount(0);
    await expect(providerLinks(page)).toHaveCount(0);
  } finally {
    finishDiscovery();
  }
  expect((await discoveryResponse).ok()).toBe(true);
  await expect(page.getByText("or sign in with")).toHaveCount(0);
  await expect(providerLinks(page)).toHaveCount(0);

  await page.getByLabel("Email address").fill("test@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/orgs/demo/projects");
});

test("provider discovery failure leaves password registration available", async ({ page }) => {
  await installApiMocks(page, { signedOut: true });
  await page.route("**/auth/providers", (route) => route.fulfill({ status: 503 }));
  await page.goto("/register?return=/projects");

  await expect(page.getByRole("status")).toHaveText(/Single sign-on options are temporarily unavailable/);
  await expect(page.getByText("or sign up with")).toHaveCount(0);
  await expect(providerLinks(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
});

test("provider discovery rejects noncanonical login URLs", async ({ page }) => {
  await installApiMocks(page, { signedOut: true });
  await page.route("**/auth/providers", (route) => route.fulfill({
    json: { providers: [google, { ...github, login_url: "https://example.invalid/login" }] },
  }));
  await page.goto("/login?sso_error=constructor");

  await expect(page.getByRole("status")).toHaveText(/Single sign-on options are temporarily unavailable/);
  await expect(providerLinks(page)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test.describe("Chinese SSO feedback", () => {
  test.use({ locale: "zh-CN" });

  test("a signed-in user can stay on an invitation and see callback feedback", async ({ page }) => {
    await installApiMocks(page);
    await page.route("**/auth/providers", (route) => route.fulfill({ json: { providers: [google, github] } }));

    await page.goto("/login?invitation=1");
    await expect(page.getByRole("status")).toHaveText(/请选择登录方式以接受邀请/);
    await expect(page.getByRole("link", { name: "使用 Google 继续" })).toBeVisible();
    await expect(page.getByRole("link", { name: "使用 GitHub 继续" })).toBeVisible();

    await page.goto("/login?sso_error=invitation_invalid");
    await expect(page.getByRole("alert")).toHaveText(/此邀请无效或已过期/);
    await expect(page.getByRole("link", { name: "使用 GitHub 继续" })).toBeVisible();
  });
});
