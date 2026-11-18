import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "changePassword.title": "Change Password",
        "changePassword.currentPassword": "Current Password",
        "changePassword.newPassword": "New Password",
        "changePassword.confirmPassword": "Confirm New Password",
        "changePassword.submit": "Update Password",
        "changePassword.cancel": "Cancel",
        "changePassword.success": "Password updated successfully",
        "changePassword.error.currentIncorrect": "Current password is incorrect",
        "changePassword.error.tooShort": "Password must be at least 8 characters",
        "changePassword.error.notMatch": "Passwords do not match",
        "changePassword.error.generic": "Failed to update password. Please try again.",
      };
      return translations[key] || key;
    },
  }),
}));

// Mock Modal and Button components
vi.mock("../../shared/ui/components", () => ({
  Modal: ({ open, title, children, onCancel, onOk, okText, cancelText, okVariant }: any) => {
    if (!open) return null;
    return (
      <div role="dialog" aria-modal="true" aria-labelledby="change-password-title">
        <div className="dialog-overlay" role="presentation" />
        <div className="dialog-title" id="change-password-title">{title}</div>
        <form onSubmit={(e) => { e.preventDefault(); onOk(); }}>
          {children}
          <button type="submit" className={`af-button af-button--${okVariant || 'primary'}`}>
            {okText}
          </button>
          <button type="button" className="af-button af-button--secondary" onClick={onCancel}>
            {cancelText}
          </button>
        </form>
      </div>
    );
  },
  Button: ({ children, variant, ...props }: any) => (
    <button {...props} className={`af-button af-button--${variant}`}>
      {children}
    </button>
  ),
}));

// Mock PasswordInput component
vi.mock("../../shared/ui/components/form-controls", () => ({
  PasswordInput: ({ label, name, value, error, disabled, required, autoComplete }: any) => (
    <div className="password-input-mock">
      <label htmlFor={name}>{label}</label>
      <input
        type="password"
        id={name}
        name={name}
        value={value}
        disabled={disabled}
        required={required}
        autoComplete={autoComplete}
      />
      {error && <span className="error">{error}</span>}
    </div>
  ),
}));

// Mock identityManagementAPI
const mockChangePassword = vi.fn();
vi.mock("../../shared/api/identities", () => ({
  identityManagementAPI: {
    changePassword: (...args: any[]) => mockChangePassword(...args),
  },
  APIError: class APIError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
      this.name = "APIError";
    }
  },
}));

describe("ChangePasswordDialog", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockChangePassword.mockResolvedValue(undefined);
  });

  describe("rendering", () => {
    it("renders nothing when open is false", () => {
      const html = renderToStaticMarkup(
        <ChangePasswordDialog {...defaultProps} open={false} />
      );

      expect(html).toBe("");
    });

    it("renders dialog with all form fields when open", () => {
      const html = renderToStaticMarkup(
        <ChangePasswordDialog {...defaultProps} open={true} />
      );

      expect(html).toContain("Change Password");
      expect(html).toContain("Current Password");
      expect(html).toContain("New Password");
      expect(html).toContain("Confirm New Password");
      expect(html).toContain("Update Password");
      expect(html).toContain("Cancel");
    });

    it("has proper dialog accessibility attributes", () => {
      const html = renderToStaticMarkup(
        <ChangePasswordDialog {...defaultProps} open={true} />
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-labelledby="change-password-title"');
      expect(html).toContain('aria-modal="true"');
    });

    it("includes overlay with presentation role", () => {
      const html = renderToStaticMarkup(
        <ChangePasswordDialog {...defaultProps} open={true} />
      );

      expect(html).toContain('class="dialog-overlay"');
      expect(html).toContain('role="presentation"');
    });
  });

  describe("form fields", () => {
    it("renders password inputs with correct autocomplete attributes", () => {
      const html = renderToStaticMarkup(
        <ChangePasswordDialog {...defaultProps} open={true} />
      );

      expect(html).toContain('name="current-password"');
      expect(html).toContain('autoComplete="current-password"');
      expect(html).toContain('name="new-password"');
      expect(html).toContain('autoComplete="new-password"');
      expect(html).toContain('name="confirm-password"');
    });

    it("marks all password fields as required", () => {
      const html = renderToStaticMarkup(
        <ChangePasswordDialog {...defaultProps} open={true} />
      );

      // Count required attributes - should have 3 (one for each password field)
      const requiredCount = (html.match(/required/g) || []).length;
      expect(requiredCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("form actions", () => {
    it("renders submit and cancel buttons", () => {
      const html = renderToStaticMarkup(
        <ChangePasswordDialog {...defaultProps} open={true} />
      );

      expect(html).toContain('type="submit"');
      expect(html).toContain('type="button"');
      expect(html).toContain("Update Password");
      expect(html).toContain("Cancel");
    });

    it("has primary styling on submit button", () => {
      const html = renderToStaticMarkup(
        <ChangePasswordDialog {...defaultProps} open={true} />
      );

      expect(html).toContain('class="af-button af-button--primary"');
    });

    it("has secondary styling on cancel button", () => {
      const html = renderToStaticMarkup(
        <ChangePasswordDialog {...defaultProps} open={true} />
      );

      expect(html).toContain('class="af-button af-button--secondary"');
    });
  });

  describe("accessibility", () => {
    it("has accessible dialog title with id", () => {
      const html = renderToStaticMarkup(
        <ChangePasswordDialog {...defaultProps} open={true} />
      );

      expect(html).toContain('id="change-password-title"');
      expect(html).toContain('class="dialog-title"');
    });

    it("uses semantic HTML with form element", () => {
      const html = renderToStaticMarkup(
        <ChangePasswordDialog {...defaultProps} open={true} />
      );

      expect(html).toContain("<form");
    });
  });
});
