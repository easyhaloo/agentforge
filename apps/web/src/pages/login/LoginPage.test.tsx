import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { LoginPage, type LoginPageProps } from "./LoginPage";

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "title": "AgentForge",
        "tagline": "Agent-native Source Control & Verified Change Platform",
        "ssoButton": "Continue with SSO",
        "trustMessage": "Secure authentication via OpenID Connect",
        "loading": "Signing in...",
      };
      return translations[key] || key;
    },
  }),
}));

function render(accountState: LoginPageProps["accountState"]): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <LoginPage accountState={accountState} />
    </MemoryRouter>
  );
}

describe("LoginPage", () => {
  it("renders product name and tagline", () => {
    const html = render("signed-out");
    expect(html).toContain('<h1 id="login-heading" class="product-name">AgentForge</h1>');
    expect(html).toContain("Agent-native Source Control &amp; Verified Change Platform");
  });

  it("renders SSO login link with correct href", () => {
    const html = render("signed-out");
    expect(html).toContain('href="/auth/oidc/login"');
    expect(html).toContain("Continue with SSO");
  });

  it("shows trust message", () => {
    const html = render("signed-out");
    expect(html).toContain("Secure authentication via OpenID Connect");
  });

  it("has accessible structure with main landmark and aria-labelledby", () => {
    const html = render("signed-out");
    expect(html).toContain('<main class="login-page" role="main" aria-labelledby="login-heading">');
  });

  it("renders brand mark", () => {
    const html = render("signed-out");
    expect(html).toContain('<div class="brand-mark" aria-hidden="true">AF</div>');
  });

  it("shows loading state when account state is loading", () => {
    const html = render("loading");
    expect(html).toContain("Signing in...");
    expect(html).not.toContain("Continue with SSO");
  });
});
