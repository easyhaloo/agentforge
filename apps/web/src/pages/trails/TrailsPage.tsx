import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Workflow, Activity } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { changesetAPI, organizationAPI, type OrganizationSummary, type StoredChangeset, type MembershipAuditEvent } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { changesetPath, organizationHandle } from "../../shared/routing";
import { Button, DataTable } from "../../shared/ui";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };

type ChangesetAuditEvent = {
  id: string;
  type: "changeset";
  changeset_id: string;
  changeset_title: string;
  sequence: number;
  actor: string;
  operation: string;
  target_id: string;
  outcome: string;
  at: string;
};

type MembershipAuditRow = MembershipAuditEvent & { type: "membership" };
type AuditEvent = ChangesetAuditEvent | MembershipAuditRow;

/** Trails workspace: shows audit trail of changeset and organization activity. */
export function TrailsPage({ organization, onNotify }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { org } = useParams();
  const handle = org || organizationHandle(organization);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showMembership, setShowMembership] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      // Load recent changesets to extract their audit events
      const changesetsPage = await changesetAPI.list(organization.id, { limit: 50, offset: 0 });

      // Extract and flatten all audit events from changesets
      const changesetEvents: ChangesetAuditEvent[] = [];
      for (const item of changesetsPage.items) {
        for (const auditEntry of item.changeset.audit) {
          changesetEvents.push({
            id: `${item.changeset.id}-${auditEntry.sequence}`,
            type: "changeset",
            changeset_id: item.changeset.id,
            changeset_title: item.changeset.title,
            sequence: auditEntry.sequence,
            actor: auditEntry.actor,
            operation: auditEntry.operation,
            target_id: auditEntry.target_id,
            outcome: auditEntry.outcome,
            at: auditEntry.at,
          });
        }
      }

      let allEvents: AuditEvent[] = changesetEvents;

      // Optionally load membership audit events
      if (showMembership) {
        try {
          const membershipPage = await organizationAPI.audit(organization.id);
          const membershipEvents: MembershipAuditRow[] = membershipPage.items.map(e => ({ ...e, type: "membership" as const }));
          allEvents = [...changesetEvents, ...membershipEvents];
        } catch {
          // Membership audit might be restricted to admins, silently skip if unauthorized
        }
      }

      // Sort by timestamp descending (newest first)
      allEvents.sort((a, b) => {
        const aTime = a.type === "changeset" ? a.at : a.created_at;
        const bTime = b.type === "changeset" ? b.at : b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

      setEvents(allEvents);
    } catch (cause) { setError(translateError(cause, t, "trails:errors.loadFailed")); }
    finally { setLoading(false); }
  }, [organization.id, showMembership, t]);

  useEffect(() => { void load(); }, [load]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "short"
    }).format(date);
  };

  return <section className="trails-page">
    <div className="changesets-summary card">
      <div className="changesets-summary__icon"><Workflow size={20}/></div>
      <div>
        <b>{t("trails:page.summary", { count: events.length })}</b>
        <p>{t("trails:page.description")}</p>
      </div>
      <span className="org-role">{organization.role}</span>
      <div className="trails-controls">
        <Button
          className="button secondary"
          onClick={() => setShowMembership(!showMembership)}
          aria-pressed={showMembership}
        >
          <Activity size={14}/> {t("trails:filters.showMembership")}
        </Button>
        <Button className="button secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14}/> {t("common:actions.refresh")}
        </Button>
      </div>
    </div>
    {error && <div className="org-error" role="alert">{error}</div>}

    <div className="trails-list card">
      <div className="changesets-list__head">
        <div>
          <h3>{t("trails:list.title")}</h3>
          <p>{t("trails:list.description", { organizationName: organization.name })}</p>
        </div>
      </div>

      {loading ? <div className="org-loading">{t("trails:page.loadingMessage")}</div> : (
        <DataTable<AuditEvent>
          aria-label={t("trails:list.title")}
          rowKey={(event) => event.type === "changeset" ? event.id : event.id}
          data={events}
          loading={loading}
          emptyText={t("trails:list.empty")}
          onRowClick={(event) => {
            if (event.type === "changeset") {
              navigate(changesetPath(handle, event.changeset_id));
            }
          }}
          columns={[
            {
              key: "timestamp",
              title: t("trails:columns.timestamp"),
              render: (_, row) => formatTimestamp(row.type === "changeset" ? row.at : row.created_at)
            },
            {
              key: "type",
              title: t("trails:columns.type"),
              render: (_, row) => (
                <span className={`audit-type audit-type--${row.type}`}>
                  {t(`trails:types.${row.type}`)}
                </span>
              )
            },
            {
              key: "subject",
              title: t("trails:columns.subject"),
              render: (_, row) => {
                if (row.type === "changeset") {
                  return <span className="trails-changeset-link">{row.changeset_title || row.changeset_id}</span>;
                } else {
                  return <span>{row.action}</span>;
                }
              }
            },
            {
              key: "actor",
              title: t("trails:columns.actor"),
              render: (_, row) => {
                if (row.type === "changeset") {
                  return <span>{row.actor}</span>;
                } else {
                  return <span>{row.actor_user_id}</span>;
                }
              }
            },
            {
              key: "operation",
              title: t("trails:columns.operation"),
              render: (_, row) => {
                if (row.type === "changeset") {
                  return <span className="trails-operation">{row.operation}</span>;
                } else {
                  return <span>{`${row.before_role} → ${row.after_role || row.after_status}`}</span>;
                }
              }
            },
            {
              key: "outcome",
              title: t("trails:columns.outcome"),
              render: (_, row) => {
                if (row.type === "changeset") {
                  return (
                    <span className={`trails-outcome trails-outcome--${row.outcome.toLowerCase()}`}>
                      {row.outcome}
                    </span>
                  );
                } else {
                  return <span>—</span>;
                }
              }
            }
          ]}
        />
      )}
      <div className="changesets-list__foot">
        <span>{t("trails:list.footer", { count: events.length })}</span>
      </div>
    </div>
  </section>;
}
