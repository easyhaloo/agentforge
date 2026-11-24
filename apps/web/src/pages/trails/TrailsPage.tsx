import { useEffect, useId, useState } from "react";
import { GitPullRequest, Users } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { changesetAPI, organizationAPI, type OrganizationSummary, type StoredChangeset, type MembershipAuditEvent } from "../../shared/api/identity";
import { APIError, translateError } from "../../shared/api/errors";
import { useDateFormatting } from "../../shared/i18n/format";
import { changesetPath, organizationHandle } from "../../shared/routing";
import { Button, Empty } from "../../shared/ui";
import { auditEntryLabel } from "../changesets/changeset-status";
import "../changesets/ui/coordination.css";

const changesetLimit = 50;

type AuditEvent = { id: string; at: string } & (
  | { type: "changeset"; event: StoredChangeset["changeset"]["audit"][number]; changesetId: string; title: string }
  | { type: "membership"; event: MembershipAuditEvent }
);

export function TrailsPage({ organization }: { organization: OrganizationSummary; onNotify: (message: string) => void }) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormatting();
  const heading = useId();
  const { org = organizationHandle(organization) } = useParams();
  const [changesets, setChangesets] = useState<AuditEvent[]>();
  const [membership, setMembership] = useState<AuditEvent[]>();
  const [error, setError] = useState("");
  const [membershipError, setMembershipError] = useState("");
  const [showMembership, setShowMembership] = useState(false);
  const [retry, setRetry] = useState(0);
  const [retryMembership, setRetryMembership] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    setChangesets(undefined);
    void changesetAPI.list(organization.id, { limit: changesetLimit, offset: 0 }).then(({ items }) => {
      if (active) setChangesets(items.flatMap(({ changeset }) => changeset.audit.map(event => ({
        id: `${changeset.id}-${event.sequence}`, type: "changeset", at: event.at,
        changesetId: changeset.id, title: changeset.title || changeset.id, event,
      }))));
    }).catch((cause: unknown) => {
      if (active) setError(translateError(cause, t, "trails:errors.loadFailed"));
    });
    return () => { active = false; };
  }, [organization.id, retry, t]);

  useEffect(() => {
    setMembershipError("");
    setMembership(undefined);
    if (!showMembership) return;
    let active = true;
    void organizationAPI.audit(organization.id).then(({ items }) => {
      if (active) setMembership(items.map(event => ({ id: event.id, type: "membership", at: event.created_at, event })));
    }).catch((cause: unknown) => {
      if (active) setMembershipError(cause instanceof APIError && cause.status === 403
        ? t("trails:errors.membershipForbidden") : t("trails:errors.membershipFailed"));
    });
    return () => { active = false; };
  }, [organization.id, showMembership, retryMembership, t]);

  const events = [...(changesets ?? []), ...(showMembership ? membership ?? [] : [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return <section className="coordination" aria-labelledby={heading}>
    <div className="coordination-toolbar">
      <div><h2 id={heading}>{t("trails:list.title")}</h2><span className="coordination-meta">{t("trails:list.scope", { count: changesetLimit })}</span></div>
      <Button aria-pressed={showMembership} onClick={() => setShowMembership(value => !value)}><Users size={16} aria-hidden="true" />{t("trails:filters.showMembership")}</Button>
    </div>
    {error && <div className="coordination-feedback"><p role="alert">{error}</p><Button onClick={() => setRetry(value => value + 1)}>{t("common:actions.retry")}</Button></div>}
    {showMembership && membershipError && <div className="coordination-feedback"><p role="alert">{membershipError}</p><Button onClick={() => setRetryMembership(value => value + 1)}>{t("common:actions.retry")}</Button></div>}
    {!error && (!changesets || (showMembership && !membershipError && !membership)) && <p role="status" className="coordination-meta">{t("trails:page.loadingMessage")}</p>}
    {events.length === 0 && changesets && (!showMembership || membership || membershipError) && <Empty title={t("trails:list.empty")} />}
    {events.length > 0 && <ol className="coordination-timeline" aria-labelledby={heading}>
      {events.map(row => {
        const Icon = row.type === "changeset" ? GitPullRequest : Users;
        const { event } = row;
        const label = "operation" in event
          ? auditEntryLabel(event.operation, event.outcome, t)
          : t(`organization:audit.actions.${event.action}`, { defaultValue: event.action });
        const actor = "actor" in event ? event.actor : event.actor_user_id;
        const target = "target_id" in event ? event.target_id : event.target_user_id;
        return <li className="coordination-event" key={`${row.type}:${row.id}`}>
          <span className="coordination-event-icon"><Icon size={16} aria-hidden="true" /></span>
          <div className="coordination-row-text">
            <div className="coordination-event-head"><strong>{label}</strong><time className="coordination-meta" dateTime={row.at}>{formatDateTime(row.at)}</time></div>
            {row.type === "changeset" && <Link to={changesetPath(org, row.changesetId)}>{row.title}</Link>}
            <p className="coordination-meta">{[t(`trails:types.${row.type}`), actor && t("trails:list.actor", { actor }), target && t("trails:list.target", { target })].filter(Boolean).join(" · ")}</p>
            {!("operation" in event) && event.before_role && event.after_role && event.before_role !== event.after_role && <p className="coordination-meta">
              {t(`organization:roles.${event.before_role}`, { defaultValue: event.before_role })} → {t(`organization:roles.${event.after_role}`, { defaultValue: event.after_role })}
            </p>}
          </div>
        </li>;
      })}
    </ol>}
  </section>;
}
