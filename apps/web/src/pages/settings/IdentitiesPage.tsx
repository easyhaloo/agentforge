import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { identityManagementAPI, type Identity } from "../../shared/api/identities";
import { translateError } from "../../shared/api/errors";
import { Button } from "../../shared/ui/components";
import { IdentityCard } from "./IdentityCard";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import "./IdentitiesPage.css";

type LoadState = "loading" | "ready" | "error";

export function IdentitiesPage() {
  const { t } = useTranslation("settings");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [error, setError] = useState<string>("");
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [notification, setNotification] = useState<string>("");

  const loadIdentities = async () => {
    setLoadState("loading");
    setError("");
    try {
      const data = await identityManagementAPI.list();
      setIdentities(data);
      setLoadState("ready");
    } catch (err: unknown) {
      setLoadState("error");
      setError(translateError(err, t, "settings:identities.error.loadFailed"));
    }
  };

  useEffect(() => {
    void loadIdentities();
  }, []);

  const handleUnlink = async (identityId: string) => {
    try {
      await identityManagementAPI.unlink(identityId);
      setNotification(t("identities.unlinkSuccess"));
      // Reload identities after unlinking
      await loadIdentities();
      // Clear notification after 3 seconds
      setTimeout(() => setNotification(""), 3000);
    } catch (err: unknown) {
      setError(translateError(err, t, "settings:identities.error.unlinkFailed"));
    }
  };

  const handlePasswordChangeSuccess = () => {
    setNotification(t("authentication.passwordChanged"));
    setTimeout(() => setNotification(""), 3000);
  };

  if (loadState === "loading") {
    return (
      <div className="settings-page">
        <div className="settings-content">
          <div className="page-header">
            <div className="header-content">
              <h1>{t("identities.title")}</h1>
              <p className="page-description">
                {t("identities.description")}
              </p>
            </div>
          </div>
          <div className="loading-message">{t("identities.loading")}</div>
        </div>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="settings-page">
        <div className="settings-content">
          <div className="page-header">
            <div className="header-content">
              <h1>{t("identities.title")}</h1>
              <p className="page-description">
                {t("identities.description")}
              </p>
            </div>
          </div>
          <div className="error-message" role="alert">
            {error}
          </div>
          <Button
            variant="secondary"
            onClick={() => void loadIdentities()}
          >
            {t("identities.retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="settings-content">
        {/* Page Header */}
        <div className="page-header">
          <div className="header-content">
            <h1>{t("identities.title")}</h1>
            <p className="page-description">
              {t("identities.description")}
            </p>
          </div>
        </div>

        {notification && (
          <div className="success-message" role="status" aria-live="polite">
            {notification}
          </div>
        )}

        <section className="identities-section">
          <h2 className="section-title">{t("identities.myLoginMethods")}</h2>

          {identities.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🔑</div>
              <h3>{t("identities.noIdentities")}</h3>
              <p>{t("identities.noIdentitiesHint")}</p>
            </div>
          ) : (
            <div className="identities-list">
              {identities.map((identity) => (
                <IdentityCard
                  key={identity.id}
                  identity={identity}
                  onChangePassword={
                    identity.issuer === "platform:internal"
                      ? () => setChangePasswordOpen(true)
                      : undefined
                  }
                  onUnlink={handleUnlink}
                  isOnly={identities.length === 1}
                />
              ))}
            </div>
          )}

          <div className="add-identity-placeholder">
            <Button
              variant="secondary"
              disabled
              title={t("identities.addNewHint")}
            >
              + {t("identities.addNew")}
            </Button>
            <p className="hint-text">{t("identities.addNewHint")}</p>
          </div>
        </section>
      </div>

      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
        onSuccess={handlePasswordChangeSuccess}
      />
    </div>
  );
}
