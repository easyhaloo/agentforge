import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { RegisterPage } from "./RegisterPage";

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock("../../shared/api/providers", () => ({
  getEnabledProviders: async () => [{ id: "oidc", loginUrl: "/auth/oidc/login" }],
}));

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "title": "New account",
        "tagline": "Join AgentForge and start collaborating",
        "email": "Email address",
        "password": "Password",
        "confirmPassword": "Confirm password",
        "displayName": "Display name",
        "createButton": "New account",
        "hasAccount": "Already have an account?",
        "signInLink": "Sign in",
        "orDivider": "or sign up with",
        "ssoButton": "Continue with SSO",
        "passwordStrength.weak": "Weak",
        "passwordStrength.medium": "Medium",
        "passwordStrength.strong": "Strong",
        "errors.emailRequired": "Email is required.",
        "errors.emailInvalid": "Invalid email format.",
        "errors.passwordRequired": "Password is required.",
        "errors.passwordWeak": "Password must be at least 8 characters long.",
        "errors.passwordMismatch": "Passwords don't match.",
        "errors.nameRequired": "Display name is required.",
        "errors.emailExists": "This email is already registered.",
        "errors.networkError": "Registration failed. Please check your connection and try again.",
        "errors.generic": "Registration failed. Please try again.",
      };
      return translations[key] || key;
    },
  }),
}));

function renderRegisterPage(initialUrl = "/register") {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/orgs/current/changesets" element={<div>Changesets Page</div>} />
        <Route path="/custom" element={<div>Custom Page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user is not authenticated
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });
  });

  it("renders registration form with all fields", async () => {
    renderRegisterPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "New account" })).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
    expect(screen.getByLabelText("Password", { selector: 'input' })).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm password", { selector: 'input' })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New account" })).toBeInTheDocument();
  });

  it("shows link to login page", async () => {
    renderRegisterPage();
    await waitFor(() => {
      expect(screen.getByText("Already have an account?")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("renders SSO button", async () => {
    renderRegisterPage();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Continue with SSO" })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Continue with SSO" })).toHaveAttribute("href", "/auth/oidc/login");
  });

  it("shows password strength indicator when typing password", async () => {
    const user = userEvent.setup();
    renderRegisterPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Password", { selector: 'input' })).toBeInTheDocument();
    });

    // No indicator initially
    expect(screen.queryByText("Weak")).not.toBeInTheDocument();

    // Type weak password
    await user.type(screen.getByLabelText("Password", { selector: 'input' }), "abc");
    await waitFor(() => {
      expect(screen.getByText("Weak")).toBeInTheDocument();
    });

    // Clear and type medium password
    await user.clear(screen.getByLabelText("Password", { selector: 'input' }));
    await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
    await waitFor(() => {
      expect(screen.getByText("Medium")).toBeInTheDocument();
    });

    // Clear and type strong password
    await user.clear(screen.getByLabelText("Password", { selector: 'input' }));
    await user.type(screen.getByLabelText("Password", { selector: 'input' }), "StrongPass123!");
    await waitFor(() => {
      expect(screen.getByText("Strong")).toBeInTheDocument();
    });
  });

  describe("Form validation", () => {
    it("shows error when email is empty", async () => {
      const user = userEvent.setup();
      renderRegisterPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Display name")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Display name"), "Test User");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.type(screen.getByLabelText("Confirm password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "New account" }));

      await waitFor(() => {
        expect(screen.getByText("Email is required.")).toBeInTheDocument();
      });
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only auth check
    });

    it("shows error when email format is invalid", async () => {
      const user = userEvent.setup();
      renderRegisterPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "invalid-email");
      await user.type(screen.getByLabelText("Display name"), "Test User");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.type(screen.getByLabelText("Confirm password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "New account" }));

      await waitFor(() => {
        expect(screen.getByText("Invalid email format.")).toBeInTheDocument();
      });
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only auth check
    });

    it("shows error when display name is empty", async () => {
      const user = userEvent.setup();
      renderRegisterPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.type(screen.getByLabelText("Confirm password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "New account" }));

      await waitFor(() => {
        expect(screen.getByText("Display name is required.")).toBeInTheDocument();
      });
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only auth check
    });

    it("shows error when password is empty", async () => {
      const user = userEvent.setup();
      renderRegisterPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Display name"), "Test User");
      await user.click(screen.getByRole("button", { name: "New account" }));

      await waitFor(() => {
        expect(screen.getByText("Password is required.")).toBeInTheDocument();
      });
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only auth check
    });

    it("shows error when password is too short", async () => {
      const user = userEvent.setup();
      renderRegisterPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Display name"), "Test User");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "short");
      await user.type(screen.getByLabelText("Confirm password", { selector: 'input' }), "short");
      await user.click(screen.getByRole("button", { name: "New account" }));

      await waitFor(() => {
        expect(screen.getByText("Password must be at least 8 characters long.")).toBeInTheDocument();
      });
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only auth check
    });

    it("shows error when passwords don't match", async () => {
      const user = userEvent.setup();
      renderRegisterPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Display name"), "Test User");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.type(screen.getByLabelText("Confirm password", { selector: 'input' }), "different123");
      await user.click(screen.getByRole("button", { name: "New account" }));

      await waitFor(() => {
        expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
      });
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only auth check
    });
  });

  describe("Registration submission", () => {
    it("submits form with valid data and redirects on success", async () => {
      const user = userEvent.setup();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // Initial auth check
        .mockResolvedValueOnce({ // Registration success
          ok: true,
          status: 201,
          json: async () => ({
            user_id: "user-123",
            email: "test@example.com",
            display_name: "Test User",
          }),
        });

      renderRegisterPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Display name"), "Test User");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.type(screen.getByLabelText("Confirm password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "New account" }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/auth/local/register",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              email: "test@example.com",
              password: "password123",
              display_name: "Test User"
            }),
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByText("Changesets Page")).toBeInTheDocument();
      });
    });

    it("redirects to return URL after successful registration", async () => {
      const user = userEvent.setup();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // Initial auth check
        .mockResolvedValueOnce({ // Registration success
          ok: true,
          status: 201,
          json: async () => ({
            user_id: "user-123",
            email: "test@example.com",
            display_name: "Test User",
          }),
        });

      renderRegisterPage("/register?return=/custom");

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Display name"), "Test User");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.type(screen.getByLabelText("Confirm password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "New account" }));

      await waitFor(() => {
        expect(screen.getByText("Custom Page")).toBeInTheDocument();
      });
    });

    it("shows error when email already exists (409)", async () => {
      const user = userEvent.setup();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // Initial auth check
        .mockResolvedValueOnce({ // Email exists
          ok: false,
          status: 409,
          json: async () => ({
            title: "Conflict",
            detail: "Email already registered",
          }),
        });

      renderRegisterPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "existing@example.com");
      await user.type(screen.getByLabelText("Display name"), "Test User");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.type(screen.getByLabelText("Confirm password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "New account" }));

      await waitFor(() => {
        expect(screen.getByText("This email is already registered.")).toBeInTheDocument();
      });
    });

    it("shows generic error on server error (500)", async () => {
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

      renderRegisterPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Display name"), "Test User");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.type(screen.getByLabelText("Confirm password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "New account" }));

      await waitFor(() => {
        expect(screen.getByText("Registration failed. Please try again.")).toBeInTheDocument();
      });
    });

    it("shows network error on fetch failure", async () => {
      const user = userEvent.setup();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // Initial auth check
        .mockRejectedValueOnce(new TypeError("Network request failed")); // Network error

      renderRegisterPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Display name"), "Test User");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.type(screen.getByLabelText("Confirm password", { selector: 'input' }), "password123");
      await user.click(screen.getByRole("button", { name: "New account" }));

      await waitFor(() => {
        expect(screen.getByText("Registration failed. Please check your connection and try again.")).toBeInTheDocument();
      });
    });

    it("disables submit button while loading", async () => {
      const user = userEvent.setup();
      let resolveRegister: (value: unknown) => void;
      const registerPromise = new Promise((resolve) => {
        resolveRegister = resolve;
      });

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // Initial auth check
        .mockReturnValueOnce(registerPromise as Promise<Response>); // Pending registration

      renderRegisterPage();

      await waitFor(() => {
        expect(screen.getByLabelText("Email address")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Email address"), "test@example.com");
      await user.type(screen.getByLabelText("Display name"), "Test User");
      await user.type(screen.getByLabelText("Password", { selector: 'input' }), "password123");
      await user.type(screen.getByLabelText("Confirm password", { selector: 'input' }), "password123");

      const submitButton = screen.getByRole("button", { name: "New account" });
      await user.click(submitButton);

      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });

      // Resolve the registration
      resolveRegister!({
        ok: true,
        status: 201,
        json: async () => ({
          user_id: "user-123",
          email: "test@example.com",
          display_name: "Test User",
        }),
      });
    });
  });
});
