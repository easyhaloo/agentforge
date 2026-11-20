import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { LoginPage } from "./LoginPage";
import type { SSOProvider } from "../../shared/api/providers";

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock providers API
const mockGetEnabledProviders = vi.fn();
vi.mock("../../shared/api/providers", () => ({
  getEnabledProviders: () => mockGetEnabledProviders(),
}));

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const translations: Record<string, string> = {
        "title": "Sign in to AgentForge",
        "email": "Email address",
        "password": "Password",
        "signInButton": "Sign in",
        "orDivider": "or",
        "orSignInWith": "or sign in with",
        "ssoButton": "Continue with SSO",
        "loading": "Signing in...",
        "providers.oidc": "SSO",
        "providers.github": "GitHub",
        "providers.google": "Google",
        "providers.apple": "Apple",
        "error.invalidCredentials": "Invalid email or password.",
        "error.networkError": "Network error. Please check your connection and try again.",
        "error.generic": "An error occurred. Please try again.",
        "error.emptyEmail": "Email is required.",
        "error.emptyPassword": "Password is required.",
      };
      return translations[key] || options?.defaultValue || key;
    },
  }),
}));

function renderLoginPage(initialUrl = "/login") {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/orgs/current/changesets" element={<div>Changesets Page</div>} />
        <Route path="/custom" element={<div>Custom Page</div>} />
      </Routes>
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
    // Default: return single OIDC provider
    mockGetEnabledProviders.mockResolvedValue([
      {
        id: "oidc",
        name: "SSO",
        loginUrl: "/auth/oidc/login",
        enabled: true,
      },
    ] as SSOProvider[]);
  });

  it("renders the sign-in heading", async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sign in to AgentForge" })).toBeInTheDocument();
    });
  });

  it("renders local login form with email and password inputs", async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Password", { selector: 'input' })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("renders SSO login link with correct href", async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "SSO" })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "SSO" })).toHaveAttribute("href", "/auth/oidc/login");
  });

  it("shows or divider between local and SSO login when providers exist", async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByText("or sign in with")).toBeInTheDocument();
    });
  });

  it("has accessible structure with main landmark", async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByRole("main")).toBeInTheDocument();
    });
  });

  it("renders brand mark", async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByText("AF")).toBeInTheDocument();
    });
  });

  describe("Dynamic SSO Provider Rendering", () => {
    it("does not show SSO section when no providers are available", async () => {
      mockGetEnabledProviders.mockResolvedValue([]);
      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      // Wait for provider loading to complete
      await waitFor(() => {
        expect(mockGetEnabledProviders).toHaveBeenCalled();
      });

      // Should not show divider or SSO section
      expect(screen.queryByText("or sign in with")).not.toBeInTheDocument();
    });

    it("renders single SSO provider", async () => {
      mockGetEnabledProviders.mockResolvedValue([
        {
          id: "oidc",
          name: "SSO",
          loginUrl: "/auth/oidc/login",
          enabled: true,
        },
      ] as SSOProvider[]);

      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByRole("link", { name: "SSO" })).toBeInTheDocument();
      });

      expect(screen.getByRole("link", { name: "SSO" })).toHaveAttribute("href", "/auth/oidc/login");
      expect(screen.getByText("or sign in with")).toBeInTheDocument();
    });

    it("renders multiple SSO providers", async () => {
      mockGetEnabledProviders.mockResolvedValue([
        {
          id: "github",
          name: "GitHub",
          loginUrl: "/auth/oidc/login?provider=github",
          enabled: true,
        },
        {
          id: "google",
          name: "Google",
          loginUrl: "/auth/oidc/login?provider=google",
          enabled: true,
        },
        {
          id: "apple",
          name: "Apple",
          loginUrl: "/auth/oidc/login?provider=apple",
          enabled: true,
        },
      ] as SSOProvider[]);

      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByRole("link", { name: "GitHub" })).toBeInTheDocument();
      });

      expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "/auth/oidc/login?provider=github");
      expect(screen.getByRole("link", { name: "Google" })).toHaveAttribute("href", "/auth/oidc/login?provider=google");
      expect(screen.getByRole("link", { name: "Apple" })).toHaveAttribute("href", "/auth/oidc/login?provider=apple");
      expect(screen.getByText("or sign in with")).toBeInTheDocument();
    });

    it("handles provider API failure gracefully", async () => {
      mockGetEnabledProviders.mockRejectedValue(new Error("Provider API failed"));

      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      // Wait for provider loading to complete
      await waitFor(() => {
        expect(mockGetEnabledProviders).toHaveBeenCalled();
      });

      // Should not show SSO section when API fails
      expect(screen.queryByText("or sign in with")).not.toBeInTheDocument();
    });

    it("does not show SSO section while loading providers", async () => {
      let resolveProviders: (value: SSOProvider[]) => void;
      const providersPromise = new Promise<SSOProvider[]>((resolve) => {
        resolveProviders = resolve;
      });

      mockGetEnabledProviders.mockReturnValue(providersPromise);

      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      // SSO section should not be visible while loading
      expect(screen.queryByText("or sign in with")).not.toBeInTheDocument();

      // Resolve with providers
      resolveProviders!([
        {
          id: "oidc",
          name: "SSO",
          loginUrl: "/auth/oidc/login",
          enabled: true,
        },
      ]);

      // Now SSO section should appear
      await waitFor(() => {
        expect(screen.getByText("or sign in with")).toBeInTheDocument();
      });
      expect(screen.getByRole("link", { name: "SSO" })).toBeInTheDocument();
    });

    it("renders GitHub provider with correct icon", async () => {
      mockGetEnabledProviders.mockResolvedValue([
        {
          id: "github",
          name: "GitHub",
          loginUrl: "/auth/oidc/login?provider=github",
          enabled: true,
        },
      ] as SSOProvider[]);

      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByRole("link", { name: "GitHub" })).toBeInTheDocument();
      });

      const githubLink = screen.getByRole("link", { name: "GitHub" });
      expect(githubLink).toHaveAttribute("href", "/auth/oidc/login?provider=github");
      // Check that SVG icon exists
      expect(githubLink.querySelector("svg")).toBeInTheDocument();
    });
  });

  describe("Local login form submission", () => {
    it("submits form with valid credentials and redirects on success", async () => {
      const user = userEvent.setup();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // Initial auth check
        .mockResolvedValueOnce({ // Login success
          ok: true,
          status: 200,
          json: async () => ({
            user_id: "user-123",
            email: "test@example.com",
            display_name: "Test User",
          }),
        });

      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/auth/local/login",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ email: "test@example.com", password: "password123" }),
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByText("Changesets Page")).toBeInTheDocument();
      });
    });

    it("redirects to return URL after successful login", async () => {
      const user = userEvent.setup();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // Initial auth check
        .mockResolvedValueOnce({ // Login success
          ok: true,
          status: 200,
          json: async () => ({
            user_id: "user-123",
            email: "test@example.com",
            display_name: "Test User",
          }),
        });

      renderLoginPage("/login?return=/custom");

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(screen.getByText("Custom Page")).toBeInTheDocument();
      });
    });

    it("shows error message on invalid credentials (401)", async () => {
      const user = userEvent.setup();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // Initial auth check
        .mockResolvedValueOnce({ // Login failure
          ok: false,
          status: 401,
          json: async () => ({
            title: "Unauthorized",
            detail: "Invalid credentials",
          }),
        });

      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "wrongpassword");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(screen.getByText("Invalid email or password.")).toBeInTheDocument();
      });
    });

    it("shows generic error message on server error (500)", async () => {
      const user = userEvent.setup();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // Initial auth check
        .mockResolvedValueOnce({ // Server error
          ok: false,
          status: 500,
          json: async () => ({
            title: "Internal Server Error",
          }),
        });

      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(screen.getByText("An error occurred. Please try again.")).toBeInTheDocument();
      });
    });

    it("shows network error on fetch failure", async () => {
      const user = userEvent.setup();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // Initial auth check
        .mockRejectedValueOnce(new TypeError("Network request failed")); // Network error

      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(screen.getByText("Network error. Please check your connection and try again.")).toBeInTheDocument();
      });
    });

    it("shows validation error when email is empty", async () => {
      const user = userEvent.setup();
      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Password", { selector: 'input' })).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(screen.getByText("Email is required.")).toBeInTheDocument();
      });
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only initial auth check
    });

    it("shows validation error when password is empty", async () => {
      const user = userEvent.setup();
      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(screen.getByText("Password is required.")).toBeInTheDocument();
      });
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only initial auth check
    });

    it("disables submit button while loading", async () => {
      const user = userEvent.setup();
      let resolveLogin: (value: unknown) => void;
      const loginPromise = new Promise((resolve) => {
        resolveLogin = resolve;
      });

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // Initial auth check
        .mockReturnValueOnce(loginPromise as Promise<Response>); // Pending login

      renderLoginPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");

      const submitButton = screen.getByRole("button", { name: "Sign in" });
      await user.click(submitButton);

      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });

      // Resolve the login
      resolveLogin!({
        ok: true,
        status: 200,
        json: async () => ({
          user_id: "user-123",
          email: "test@example.com",
          display_name: "Test User",
        }),
      });
    });
  });
});
