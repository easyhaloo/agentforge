import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Identity } from "../../shared/api/identities";
import { useDateFormatting } from "../../shared/i18n/format";
import { Button, ConfirmDialog } from "../../shared/ui/components";

export interface IdentityCardProps {
  identity: Identity;
  onChangePassword?: () => void;
  onUnlink?: (id: string) => void;
  isOnly: boolean;
}

export function IdentityCard({ identity, onChangePassword, onUnlink, isOnly }: IdentityCardProps) {
  const { t } = useTranslation("settings");
  const { formatDate } = useDateFormatting();
  const [confirmUnlinkOpen, setConfirmUnlinkOpen] = useState(false);

  const isPlatformPassword = identity.issuer === "platform:internal";
  const formattedDate = formatDate(identity.created_at);

  const getProviderIcon = () => {
    if (isPlatformPassword) {
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path
            d="M15 8.5H5V5.5C5 3.84315 6.34315 2.5 8 2.5H12C13.6569 2.5 15 3.84315 15 5.5V8.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <rect
            x="3.5"
            y="8.5"
            width="13"
            height="9"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="10" cy="13" r="1.5" fill="currentColor" />
        </svg>
      );
    }

    // Default icon for other providers
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 6V10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  };

  const handleUnlink = () => {
    if (!isOnly && onUnlink) {
      setConfirmUnlinkOpen(true);
    }
  };

  const confirmUnlink = () => {
    if (onUnlink) {
      onUnlink(identity.id);
    }
    setConfirmUnlinkOpen(false);
  };

  return (
    <>
      <div className="identity-card">
        <div className="identity-card__icon">
          {getProviderIcon()}
        </div>
        <div className="identity-card__content">
          <div className="identity-card__header">
            <h3 className="identity-card__title">
              {identity.provider_display || t("identities.platformPassword")}
            </h3>
            {identity.email && (
              <p className="identity-card__email">{identity.email}</p>
            )}
          </div>
          <p className="identity-card__meta">
            {t("identities.connectedAt")}: {formattedDate}
          </p>
        </div>
        <div className="identity-card__actions">
          {isPlatformPassword && onChangePassword && (
            <Button
              variant="secondary"
              onClick={onChangePassword}
            >
              {t("identities.changePassword")}
            </Button>
          )}
          {!isPlatformPassword && onUnlink && (
            <Button
              variant="danger"
              onClick={handleUnlink}
              disabled={isOnly}
              title={isOnly ? t("identities.cannotUnlinkLast") : undefined}
              aria-label={isOnly ? t("identities.cannotUnlinkLast") : t("identities.unlink")}
            >
              {t("identities.unlink")}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmUnlinkOpen}
        title={t("identities.unlinkConfirm")}
        description={t("identities.unlinkDescription", { provider: identity.provider_display })}
        confirmText={t("identities.unlink")}
        danger
        onCancel={() => setConfirmUnlinkOpen(false)}
        onConfirm={confirmUnlink}
      />
    </>
  );
}
