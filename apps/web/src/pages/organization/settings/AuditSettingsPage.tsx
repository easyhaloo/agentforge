import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "../../../shared/ui";
import { organizationLifecycleAPI, type LifecycleAuditEvent } from "../../../shared/api/organizationLifecycle";
import { translateError } from "../../../shared/api/errors";
import { useDateFormatting } from "../../../shared/i18n/format";
import type { OrganizationLifecycleState } from "./useOrganizationLifecycle";

/** Audit page: merged membership + lifecycle events with client-side filtering. */
export function OrganizationAuditSettingsPage({ lifecycle }: { lifecycle: OrganizationLifecycleState }) {
  const { t } = useTranslation("settings");
  const { formatDateTime } = useDateFormatting();
  const [events, setEvents] = useState<LifecycleAuditEvent[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let active = true;
    void organizationLifecycleAPI.audit(lifecycle.organization.id).then(
      (page) => { if (active) setEvents(page.items); },
      (cause) => { if (active) setError(translateError(cause, t, "settings:lifecycle.errors.auditLoadFailed")); },
    );
    return () => { active = false; };
  }, [lifecycle.organization.id, t]);

  const visible = useMemo(() => {
    if (!events) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return events;
    return events.filter((event) =>
      `${event.action} ${event.actor_user_id} ${event.target_user_id ?? ""}`.toLowerCase().includes(needle));
  }, [events, filter]);

  const actionLabel = (action: string) => {
    const key = `settings:lifecycle.audit.actions.${action}`;
    const translated = t(key);
    // t() returns the key itself when missing; keep the server value then.
    return translated === key ? action.replaceAll("_", " ") : translated;
  };

  return <div className="org-lifecycle-page">
    <h2 className="org-lifecycle-subhead">{t("settings:lifecycle.audit.title")}</h2>
    <p className="org-lifecycle-description">{t("settings:lifecycle.audit.description")}</p>
    <Input
      label={t("settings:lifecycle.audit.searchPlaceholder")}
      value={filter}
      onChange={(event) => setFilter(event.target.value)}
      placeholder={t("settings:lifecycle.audit.searchPlaceholder")}
    />
    {error && <div className="org-lifecycle-error" role="alert">{error}</div>}
    <div className="org-audit-list">
      {visible.map((event) => (
        <article key={event.id} className="org-audit-row">
          <div>
            <strong>{actionLabel(event.action)}</strong>
            <p>
              {t("settings:lifecycle.audit.actor")} <code>{event.actor_user_id}</code>
              {event.target_user_id ? <> · {event.target_user_id}</> : null}
            </p>
          </div>
          <time dateTime={event.created_at}>{formatDateTime(event.created_at)}</time>
        </article>
      ))}
      {events && !visible.length && <p className="org-lifecycle-empty">{t("settings:lifecycle.audit.empty")}</p>}
      {!events && !error && <p className="org-lifecycle-empty" role="status">…</p>}
    </div>
  </div>;
}
