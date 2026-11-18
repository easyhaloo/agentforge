import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoginPage } from "./LoginPage";

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

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

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user is not authenticated (401 response)
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });
  });

  it("renders product name and tagline", () => {
    const html = render();
    expect(html).toContain('<h1 id="login-heading" class="product-name">AgentForge</h1>');
    expect(html).toContain("Agent-native Source Control &amp; Verified Change Platform");
  });

  it("renders SSO login link with correct href", () => {
    const html = render();
    expect(html).toContain('href="/auth/oidc/login"');
    expect(html).toContain("Continue with SSO");
  });

  it("shows trust message", () => {
    const html = render();
    expect(html).toContain("Secure authentication via OpenID Connect");
  });

  it("has accessible structure with main landmark and aria-labelledby", () => {
    const html = render();
    expect(html).toContain('<main class="login-page" role="main" aria-labelledby="login-heading">');
  });

  it("renders brand mark", () => {
    const html = render();
    expect(html).toContain('<div class="brand-mark" aria-hidden="true">AF</div>');
  });
});
