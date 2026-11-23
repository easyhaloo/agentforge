import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { ConfirmDialog, Button } from "../../shared/ui/components";
import { settingsAPI, type Session } from "../../shared/api/settings";
import { translateError } from "../../shared/api/errors";
import { useDateFormatting } from "../../shared/i18n/format";
import { useSettingsList } from "./useSettingsList";
import type { SettingsOutletContext } from "./SettingsLayout";

import "./access-settings.css";

const devices = {
  desktop: [Monitor, "sessions.deviceTypes.desktop"],
  mobile: [Smartphone, "sessions.deviceTypes.mobile"],
  tablet: [Tablet, "sessions.deviceTypes.tablet"],
  unknown: [Monitor, "sessions.deviceTypes.unknown"],
} as const;

function SessionRow({ session, children }: { session: Session; children?: React.ReactNode }) {
  const { t } = useTranslation("settings");
  const { formatDate, formatRelativeTime } = useDateFormatting();
  const [Icon, deviceLabel] = devices[session.device_type] ?? devices.unknown;
  return (
    <li className="settings-box-row access-row">
      <Icon className="access-icon" size={20} aria-hidden="true" />
      <div className="access-details">
        <div className="access-title">
          <strong>{session.browser} · {session.os}</strong>
          {session.is_current && <span className="access-badge">{t("sessions.current")}</span>}
        </div>
        <div className="settings-note access-meta">
          <span>{t("sessions.device")}: {t(deviceLabel)}</span>
          {session.ip_address && <span>{t("sessions.ipAddress")}: {session.ip_address}</span>}
          {session.location && <span>{t("sessions.location")}: {session.location}</span>}
        </div>
        <div className="settings-note access-meta">
          <span>{t("sessions.createdAt")}: <time dateTime={session.created_at}>{formatDate(session.created_at)}</time></span>
          {session.last_active_at && session.last_active_at !== session.created_at && (
            <span>{t("sessions.lastActive")}: <time dateTime={session.last_active_at}>{formatRelativeTime(session.last_active_at)}</time></span>
          )}
        </div>
      </div>
      {children}
    </li>
  );
}

export function SessionsSettingsPage() {
  const { t } = useTranslation("settings");
  const { notify } = useOutletContext<SettingsOutletContext>();

  const { items: sessions, loading, refresh } = useSettingsList(settingsAPI.getSessions);
  const [sessionToRevoke, setSessionToRevoke] = useState<Session | null>(null);
  const [showRevokeAllDialog, setShowRevokeAllDialog] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const handleRevokeSession = async (session: Session) => {
    if (session.is_current) return;

    setRevoking(true);
    try {
      await settingsAPI.revokeSession(session.session_id);
      notify(t("sessions.sessionRevoked"));
      refresh();
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
      refresh();
    } catch (err) {
      notify(translateError(err, t, "settings:errors.revokeSessionsFailed"));
    } finally {
      setRevoking(false);
      setShowRevokeAllDialog(false);
    }
  };

  const currentSession = sessions?.find((session) => session.is_current);
  const otherSessions = sessions?.filter((session) => !session.is_current) ?? [];

  return (
    <div className="settings-page access-settings">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("sessions.title")}</h1>
        <p className="settings-page-description">{t("sessions.description")}</p>
      </header>
      {loading ? (
        <p className="settings-note" role="status">{t("common:status.loading")}</p>
      ) : !sessions ? (
        <div className="access-meta">
          <p role="alert">{t("sessions.loadError")}</p>
          <Button onClick={refresh}>{t("common:actions.retry")}</Button>
        </div>
      ) : (
        <div className="settings-stack">
          {currentSession && (
            <section>
              <h2 className="settings-section-heading">{t("sessions.currentSession")}</h2>
              <ul className="settings-box access-list"><SessionRow session={currentSession} /></ul>
            </section>
          )}
          <section>
            <div className="settings-section-heading access-toolbar">
              <h2>{t("sessions.otherSessions")}</h2>
              {otherSessions.length > 0 && (
                <Button size="small" onClick={() => setShowRevokeAllDialog(true)} disabled={revoking}>
                  {t("sessions.revokeAllOther")}
                </Button>
              )}
            </div>
            <ul className="settings-box access-list">
              {otherSessions.length === 0 && <li className="settings-box-row settings-note">{t("sessions.noOtherSessions")}</li>}
              {otherSessions.map((session) => (
                <SessionRow key={session.session_id} session={session}>
                  <Button size="small" onClick={() => setSessionToRevoke(session)} disabled={revoking}>
                    {t("sessions.revokeSession")}
                  </Button>
                </SessionRow>
              ))}
            </ul>
          </section>
        </div>
      )}

      {/* Revoke Single Session Dialog */}
      <ConfirmDialog
        open={sessionToRevoke !== null}
        title={t("sessions.revokeConfirmTitle")}
        description={`${t("sessions.revokeConfirm")} ${sessionToRevoke?.browser ?? ""} · ${sessionToRevoke?.ip_address || sessionToRevoke?.os || ""}`}
        confirmText={t("sessions.revokeSession")}
        danger
        onConfirm={() => { if (sessionToRevoke) return handleRevokeSession(sessionToRevoke); }}
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
