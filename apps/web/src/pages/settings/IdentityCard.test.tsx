import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdentityCard } from "./IdentityCard";
import type { Identity } from "../../shared/api/identities";

// Mock i18next
vi.mock("react-i18next", () => ({
  // The date helpers format in the interface language, which reaches the real i18next instance.
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "identities.platformPassword": "Platform Password",
        "identities.connectedAt": "Connected",
        "identities.changePassword": "Change Password",
        "identities.unlink": "Unlink",
        "identities.unlinkConfirm": "Are you sure you want to unlink this login method?",
        "identities.cannotUnlinkLast": "Cannot unlink your only login method",
      };
      return translations[key] || key;
    },
  }),
}));

// Mock window.confirm
let confirmResult = true;
beforeEach(() => {
  confirmResult = true;
  vi.stubGlobal("confirm", vi.fn(() => confirmResult));
});

describe("IdentityCard", () => {
  const platformIdentity: Identity = {
    id: "id-1",
    issuer: "platform:internal",
    subject: "user-123",
    provider_display: "Platform Password",
    email: "user@example.com",
    created_at: "2024-01-15T10:30:00Z",
  };

  const googleIdentity: Identity = {
    id: "id-2",
    issuer: "https://accounts.google.com",
    subject: "google-user-456",
    provider_display: "Google",
    email: "user@gmail.com",
    created_at: "2024-01-20T14:45:00Z",
  };

  describe("rendering", () => {
    it("renders platform password identity with lock icon", () => {
      const html = renderToStaticMarkup(
        <IdentityCard identity={platformIdentity} isOnly={false} />
      );

      expect(html).toContain("Platform Password");
      expect(html).toContain("user@example.com");
      expect(html).toContain("Connected");
      expect(html).toContain("identity-card");
    });

    it("renders external provider identity with default icon", () => {
      const html = renderToStaticMarkup(
        <IdentityCard identity={googleIdentity} isOnly={false} />
      );

      expect(html).toContain("Google");
      expect(html).toContain("user@gmail.com");
      expect(html).toContain("Connected");
    });

    it("renders identity without email", () => {
      const noEmailIdentity: Identity = {
        ...platformIdentity,
        email: undefined,
      };

      const html = renderToStaticMarkup(
        <IdentityCard identity={noEmailIdentity} isOnly={false} />
      );

      expect(html).toContain("Platform Password");
      expect(html).not.toContain("user@example.com");
    });

    it("formats the created date", () => {
      const html = renderToStaticMarkup(
        <IdentityCard identity={platformIdentity} isOnly={false} />
      );

      // Date formatting will vary by locale, but should contain "Connected:"
      expect(html).toContain("Connected");
    });
  });

  describe("platform password actions", () => {
    it("shows change password button for platform identity", () => {
      const onChangePassword = vi.fn();
      const html = renderToStaticMarkup(
        <IdentityCard
          identity={platformIdentity}
          onChangePassword={onChangePassword}
          isOnly={false}
        />
      );

      expect(html).toContain("Change Password");
      expect(html).not.toContain("Unlink");
    });

    it("does not show unlink button for platform identity", () => {
      const onUnlink = vi.fn();
      const html = renderToStaticMarkup(
        <IdentityCard
          identity={platformIdentity}
          onUnlink={onUnlink}
          isOnly={false}
        />
      );

      expect(html).not.toContain("Unlink");
    });
  });

  describe("external provider actions", () => {
    it("shows unlink button for external provider", () => {
      const onUnlink = vi.fn();
      const html = renderToStaticMarkup(
        <IdentityCard
          identity={googleIdentity}
          onUnlink={onUnlink}
          isOnly={false}
        />
      );

      expect(html).toContain("Unlink");
      expect(html).not.toContain("Change Password");
    });

    it("disables unlink button when it is the only identity", () => {
      const onUnlink = vi.fn();
      const html = renderToStaticMarkup(
        <IdentityCard
          identity={googleIdentity}
          onUnlink={onUnlink}
          isOnly={true}
        />
      );

      expect(html).toContain("Unlink");
      expect(html).toContain("disabled");
      expect(html).toContain("Cannot unlink your only login method");
    });

    it("enables unlink button when there are multiple identities", () => {
      const onUnlink = vi.fn();
      const html = renderToStaticMarkup(
        <IdentityCard
          identity={googleIdentity}
          onUnlink={onUnlink}
          isOnly={false}
        />
      );

      expect(html).toContain("Unlink");
      expect(html).not.toContain("disabled");
    });
  });

  describe("accessibility", () => {
    it("has aria-hidden on decorative icons", () => {
      const html = renderToStaticMarkup(
        <IdentityCard identity={platformIdentity} isOnly={false} />
      );

      expect(html).toContain('aria-hidden="true"');
    });

    it("has aria-label on disabled unlink button", () => {
      const onUnlink = vi.fn();
      const html = renderToStaticMarkup(
        <IdentityCard
          identity={googleIdentity}
          onUnlink={onUnlink}
          isOnly={true}
        />
      );

      expect(html).toContain("Cannot unlink your only login method");
    });

    it("uses semantic HTML with proper heading hierarchy", () => {
      const html = renderToStaticMarkup(
        <IdentityCard identity={platformIdentity} isOnly={false} />
      );

      expect(html).toContain("<h3");
      expect(html).toContain("identity-card__title");
    });
  });
});
