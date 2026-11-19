import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { Button } from "../../shared/ui/components";
import { settingsAPI, type Session } from "../../shared/api/settings";
import { translateError } from "../../shared/api/errors";
import { formatDate, formatRelativeTime } from "../../shared/i18n/format";
import type { SettingsOutletContext } from "./SettingsLayout";

// Simple confirm dialog component (inline for now)
function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("settings");

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: "var(--color-surface)",
          borderRadius: "8px",
          padding: "24px",
          maxWidth: "400px",
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 12px 0", fontSize: "18px", fontWeight: 600 }}>{title}</h3>
        <p style={{ margin: "0 0 24px 0", color: "var(--color-text-secondary)" }}>{description}</p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onCancel}>
            {cancelText || t("common:actions.cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

function getDeviceIcon(deviceType: Session["device_type"]) {
  switch (deviceType) {
    case "mobile":
      return <Smartphone size={20} />;
    case "tablet":
      return <Tablet size={20} />;
    default:
      return <Monitor size={20} />;
  }
}

/** The details of one session, with every label translated. */
function SessionDetails({ session }: { session: Session }) {
  const { t } = useTranslation("settings");

  const deviceTypeLabel = (deviceType: Session["device_type"]) => {
    switch (deviceType) {
      case "mobile":
        return t("sessions.deviceTypes.mobile");
      case "tablet":
        return t("sessions.deviceTypes.tablet");
      case "desktop":
        return t("sessions.deviceTypes.desktop");
      default:
        return t("sessions.deviceTypes.unknown");
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px" }}>
      <div style={{ fontWeight: 500 }}>
        {t("sessions.browser")}: {session.browser}
      </div>
      <div style={{ color: "var(--color-text-secondary)" }}>
        {t("sessions.device")}: {deviceTypeLabel(session.device_type)}
      </div>
      <div style={{ color: "var(--color-text-secondary)" }}>
        {t("sessions.os")}: {session.os}
      </div>
      <div style={{ color: "var(--color-text-secondary)" }}>
        {t("sessions.ipAddress")}: {session.ip_address}
      </div>
      {session.location && (
        <div style={{ color: "var(--color-text-secondary)" }}>
          {t("sessions.location")}: {session.location}
        </div>
      )}
      <div style={{ color: "var(--color-text-tertiary)" }}>
        {t("sessions.createdAt")}: {formatDate(session.created_at)}
      </div>
      <div style={{ color: "var(--color-text-tertiary)" }}>
        {t("sessions.lastActive")}: {formatRelativeTime(session.last_active_at)}
      </div>
    </div>
  );
}

export function SessionsSettingsPage() {
  const { t } = useTranslation("settings");
  const { notify } = useOutletContext<SettingsOutletContext>();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionToRevoke, setSessionToRevoke] = useState<Session | null>(null);
  const [showRevokeAllDialog, setShowRevokeAllDialog] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const data = await settingsAPI.getSessions();
      setSessions(data);
    } catch (err) {
      notify(translateError(err, t, "settings:errors.loadSessionsFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleRevokeSession = async (session: Session) => {
    if (session.is_current) return;

    setRevoking(true);
    try {
      await settingsAPI.revokeSession(session.session_id);
      notify(t("sessions.sessionRevoked"));
      await loadSessions();
    } catch (err) {
      notify(translateError(err, t, "settings:errors.revokeSessionFailed"));
    } finally {
      setRevoking(false);
      setSessionToRevoke(null);
    }
  };

  const handleRevokeAll = async () => {
    setRevoking(true);
    try {
      const result = await settingsAPI.revokeAllOtherSessions();
      notify(t("sessions.revokeAllSuccess", { count: result.revoked_count }));
      await loadSessions();
    } catch (err) {
      notify(translateError(err, t, "settings:errors.revokeSessionsFailed"));
    } finally {
      setRevoking(false);
      setShowRevokeAllDialog(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("sessions.title")}</h1>
          <p className="settings-page-description">{t("sessions.description")}</p>
        </header>
        <div className="settings-placeholder">
          {t("common:status.loading", { ns: "common" })}
        </div>
      </div>
    );
  }

  const currentSession = sessions.find((s) => s.is_current);
  const otherSessions = sessions.filter((s) => !s.is_current);

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("sessions.title")}</h1>
        <p className="settings-page-description">{t("sessions.description")}</p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
        {/* Current Session */}
        {currentSession && (
          <section>
            <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "var(--color-text-primary)" }}>
              {t("sessions.currentSession")}
            </h2>
            <div className="settings-card">
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                <div style={{ color: "var(--color-text-secondary)", marginTop: "2px" }}>
                  {getDeviceIcon(currentSession.device_type)}
                </div>
                <SessionDetails session={currentSession} />
                <span
                  style={{
                    padding: "4px 8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    fontWeight: 500,
                    backgroundColor: "var(--color-primary-bg)",
                    color: "var(--color-primary)",
                  }}
                >
                  {t("sessions.current")}
                </span>
              </div>
            </div>
          </section>
        )}

        {/* Other Sessions */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0, color: "var(--color-text-primary)" }}>
              {t("sessions.otherSessions")}
            </h2>
            {otherSessions.length > 0 && (
              <Button
                variant="danger"
                size="small"
                onClick={() => setShowRevokeAllDialog(true)}
                disabled={revoking}
              >
                {t("sessions.revokeAllOther")}
              </Button>
            )}
          </div>

          {otherSessions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px", color: "var(--color-text-tertiary)" }}>
              {t("sessions.noOtherSessions")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {otherSessions.map((session) => (
                <div key={session.session_id} className="settings-card">
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                    <div style={{ color: "var(--color-text-secondary)", marginTop: "2px" }}>
                      {getDeviceIcon(session.device_type)}
                    </div>
                    <SessionDetails session={session} />
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => setSessionToRevoke(session)}
                      disabled={revoking}
                    >
                      {t("sessions.revokeSession")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Revoke Single Session Dialog */}
      <ConfirmDialog
        open={sessionToRevoke !== null}
        title={t("sessions.revokeConfirmTitle")}
        description={t("sessions.revokeConfirm")}
        confirmText={t("sessions.revokeSession")}
        danger
        onConfirm={() => sessionToRevoke && handleRevokeSession(sessionToRevoke)}
        onCancel={() => setSessionToRevoke(null)}
      />

      {/* Revoke All Sessions Dialog */}
      <ConfirmDialog
        open={showRevokeAllDialog}
        title={t("sessions.revokeAllOther")}
        description={t("sessions.revokeAllConfirm")}
        confirmText={t("sessions.revokeAllOther")}
        danger
        onConfirm={handleRevokeAll}
        onCancel={() => setShowRevokeAllDialog(false)}
      />
    </div>
  );
}
