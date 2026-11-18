import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
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
        "email": "Email address",
        "password": "Password",
        "signInButton": "Sign in",
        "orDivider": "or",
        "ssoButton": "Continue with SSO",
        "trustMessage": "Secure authentication via OpenID Connect",
        "loading": "Signing in...",
        "error.invalidCredentials": "Invalid email or password.",
        "error.networkError": "Network error. Please check your connection and try again.",
        "error.generic": "An error occurred. Please try again.",
        "error.emptyEmail": "Email is required.",
        "error.emptyPassword": "Password is required.",
      };
      return translations[key] || key;
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
  });

  it("renders product name and tagline", async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "AgentForge" })).toBeInTheDocument();
    });
    expect(screen.getByText("Agent-native Source Control & Verified Change Platform")).toBeInTheDocument();
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
      expect(screen.getByRole("link", { name: "Continue with SSO" })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Continue with SSO" })).toHaveAttribute("href", "/auth/oidc/login");
  });

  it("shows or divider between local and SSO login", async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByText("or")).toBeInTheDocument();
    });
  });

  it("shows trust message", async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByText("Secure authentication via OpenID Connect")).toBeInTheDocument();
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
