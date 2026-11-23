import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Ban, Building2, Check, Clipboard, Ellipsis, History, Mail, RefreshCw, ShieldCheck, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { organizationAPI, type CreatedInvitation, type MembershipAuditEvent, type OrganizationInvitation, type OrganizationMember, type OrganizationSummary } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { useDateFormatting } from "../../shared/i18n/format";
import { Button, ConfirmDialog, DataTable, Input, Popover, Select, Tabs } from "../../shared/ui";

import { AccountAvatar } from "../../shared/ui/components/AccountAvatar";
import "./organization-settings.css";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };
type Tab = "members" | "invitations" | "audit";

const statusTone = (status: string) => {
  switch (status) {
    case "active": case "accepted": return "success";
    case "pending": case "invited": return "warning";
    case "suspended": case "removed": case "revoked": return "danger";
    default: return "neutral";
  }
};

export function OrganizationManagementPage({ organization, onNotify }: Props) {
  const { t } = useTranslation("organization");
  const { formatDateTime } = useDateFormatting();
  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [events, setEvents] = useState<MembershipAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const inviteEmail = useRef<HTMLInputElement>(null);
  const focusInviteEmail = useRef(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [busyID, setBusyID] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<OrganizationMember | null>(null);

  /** The translated name of a role; an unknown role keeps the value the server sent. */
  const roleLabel = (value: string) => {
    switch (value) {
      case "owner": return t("roles.owner");
      case "admin": return t("roles.admin");
      case "member": return t("roles.member");
      case "viewer": return t("roles.viewer");
      default: return value;
    }
  };

  /** The translated name of a membership or invitation status. */
  const statusLabel = (value: string) => {
    switch (value) {
      case "active": return t("statuses.active");
      case "invited": return t("statuses.invited");
      case "pending": return t("statuses.pending");
      case "accepted": return t("statuses.accepted");
      case "suspended": return t("statuses.suspended");
      case "removed": return t("statuses.removed");
      case "revoked": return t("statuses.revoked");
      case "expired": return t("statuses.expired");
      default: return value;
    }
  };

  /** The translated name of an audit event; an unknown event keeps the value the server sent. */
  const auditActionLabel = (value: string) => {
    switch (value) {
      case "role_changed": return t("audit.actions.role_changed");
      case "suspended": return t("audit.actions.suspended");
      case "reactivated": return t("audit.actions.reactivated");
      case "removed": return t("audit.actions.removed");
      case "invite_accepted": return t("audit.actions.invite_accepted");
      default: return value.replaceAll("_", " ");
    }
  };

  const canAdmin = organization.role === "owner" || organization.role === "admin";
  const load = useCallback(async () => {
    if (!canAdmin) return;
    setLoading(true); setError("");
    try {
      const [memberPage, invitationPage, auditPage] = await Promise.all([
        organizationAPI.members(organization.id),
        organizationAPI.invitations(organization.id),
        organizationAPI.audit(organization.id),
      ]);
      setMembers(memberPage.items); setInvitations(invitationPage.items); setEvents(auditPage.items);
      setLoaded(true);
    } catch (cause) {
      setError(translateError(cause, t, "organization:feedback.loadFailed"));
    } finally { setLoading(false); }
  }, [organization.id, canAdmin]);

  useEffect(() => { setCreated(null); void load(); }, [load]);

  useEffect(() => {
    if (tab === "invitations" && focusInviteEmail.current) {
      inviteEmail.current?.focus();
      focusInviteEmail.current = false;
    }
  }, [tab]);

  const updateMember = async (member: OrganizationMember, update: { role?: string; status?: string }) => {
    setBusyID(member.user_id); setError("");
    try { await organizationAPI.updateMember(organization.id, member.user_id, update); await load(); onNotify(t("feedback.memberUpdated")); }
    catch (cause) { setError(translateError(cause, t, "organization:feedback.memberUpdateFailed")); }
    finally { setBusyID(""); }
  };
  const removeMember = async (member: OrganizationMember) => {
    setBusyID(member.user_id); setError("");
    try { await organizationAPI.removeMember(organization.id, member.user_id); await load(); onNotify(t("feedback.memberRemoved")); }
    catch (cause) { setError(translateError(cause, t, "organization:feedback.memberRemovalFailed")); }
    finally { setBusyID(""); }
  };
  const createInvitation = async (event: FormEvent) => {
    event.preventDefault(); setCreating(true); setError("");
    try {
      const result = await organizationAPI.createInvitation(organization.id, email.trim(), role);
      setCreated(result); setEmail(""); await load();
      onNotify(t("feedback.invitationCreated"));
    } catch (cause) { setError(translateError(cause, t, "organization:feedback.invitationCreationFailed")); }
    finally { setCreating(false); }
  };
  const revokeInvitation = async (invitation: OrganizationInvitation) => {
    setBusyID(invitation.id); setError("");
    try { await organizationAPI.revokeInvitation(organization.id, invitation.id); await load(); onNotify(t("feedback.invitationRevoked")); }
    catch (cause) { setError(translateError(cause, t, "organization:feedback.invitationRevocationFailed")); }
    finally { setBusyID(""); }
  };
  const copyInvitation = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.invitation_url); onNotify(t("feedback.invitationLinkCopied")); }
    catch { setError(t("feedback.clipboardUnavailable")); }
  };

  const renderStatus = (status: string) => (
    <span className={`org-label org-label--${statusTone(status)}`}>{statusLabel(status)}</span>
  );
  const renderDate = (date: string) => <time dateTime={date}>{formatDateTime(date)}</time>;
  const canManageMember = (member: OrganizationMember) =>
    member.status !== "removed" && (organization.role === "owner" || member.role === "member" || member.role === "viewer");
  const roleOptions = organization.role === "owner" ? ["admin", "member", "viewer"] : ["member", "viewer"];

  return <section className="org-settings" aria-labelledby="org-settings-title">
    <header className="org-admin-summary">
      <span className="org-admin-summary__icon"><Building2 size={24} aria-hidden="true" /></span>
      <div className="org-admin-summary__identity">
        <div className="org-admin-summary__title">
          <h1 id="org-settings-title">{organization.name}</h1>
          <span className="org-label">{roleLabel(organization.role)}</span>
        </div>
        <p>{t("page.description")}</p>
      </div>
      {canAdmin && <Button onClick={() => void load()} disabled={loading}>
        <RefreshCw size={16} aria-hidden="true" /> {t("common:actions.refresh")}
      </Button>}
    </header>
    {!canAdmin ? <div className="org-settings-empty">
      <ShieldCheck size={26} aria-hidden="true" />
      <h2>{t("page.restrictedTitle")}</h2>
      <p>{t("page.restrictedDescription", { role: roleLabel(organization.role) })}</p>
    </div> : <>
      <Tabs
        id="organization-admin"
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        ariaLabel={t("tabs.ariaLabel")}
        className="org-tabs"
        items={[
          { key: "members", label: <><Users size={16} aria-hidden="true" /> {t("tabs.members")} {loaded && <span className="org-count">{members.length}</span>}</> },
          { key: "invitations", label: <><Mail size={16} aria-hidden="true" /> {t("tabs.invitations")} {loaded && <span className="org-count">{invitations.length}</span>}</> },
          { key: "audit", label: <><History size={16} aria-hidden="true" /> {t("tabs.audit")}</> },
        ]}
      />
      {error && <div className="org-settings-error" role="alert">{error}</div>}
      {created && <div className="org-invite-created">
        <div><strong>{t("invitations.created.title")}</strong><p>{t("invitations.created.description")}</p></div>
        <Button variant="ghost" className="org-icon-action" aria-label={t("invitations.created.dismissAriaLabel")} onClick={() => setCreated(null)}><X size={16} aria-hidden="true" /></Button>
        <code>{created.invitation_url}</code>
        <Button onClick={() => void copyInvitation()}><Clipboard size={16} aria-hidden="true" /> {t("invitations.created.copyButton")}</Button>
      </div>}
      <div className="org-panel" role="tabpanel" id="organization-admin-panel" aria-labelledby={`organization-admin-tab-${tab}`} tabIndex={0} aria-busy={loading}>
        {!loaded ? (loading && <div className="org-settings-loading" role="status">{t("page.loading")}</div>) : tab === "members" ? <>
          <div className="org-panel-head">
            <h2>{t("members.title")}</h2>
            <Button variant="primary" onClick={() => { focusInviteEmail.current = true; setTab("invitations"); }}>
              <UserPlus size={16} aria-hidden="true" /> {t("members.actions.invite")}
            </Button>
          </div>
          <DataTable
            className="org-table"
            aria-label={t("members.title")}
            columns={[
              { key: "display_name", title: t("members.columns.member"), render: (_, member) => <div className="org-member">
                <AccountAvatar userId={member.user_id} size={32} />
                <div>
                  <strong>{member.display_name}</strong>
                  <small>{member.email || member.user_id}</small>
                  <div className="org-mobile-meta">{renderStatus(member.status)} {renderDate(member.created_at)}</div>
                </div>
              </div> },
              { key: "role", title: t("members.columns.role"), render: (_, member) => canManageMember(member) ? (
                <Select
                  aria-label={t("members.actions.roleAriaLabel", { memberName: member.display_name })}
                  menuTitle={t("members.columns.role")}
                  value={member.role}
                  disabled={busyID === member.user_id}
                  onChange={(event) => { if (event.target.value !== member.role) void updateMember(member, { role: event.target.value }); }}
                  options={[...new Set([...roleOptions, member.role])].map((value) => ({ label: roleLabel(value), value }))}
                />
              ) : <span className="org-label">{roleLabel(member.role)}</span> },
              { key: "status", title: t("members.columns.status"), render: (_, member) => renderStatus(member.status) },
              { key: "created_at", title: t("members.columns.joined"), render: (_, member) => renderDate(member.created_at) },
              { key: "actions", title: t("members.columns.actions"), render: (_, member) => {
                if (!canManageMember(member)) return null;
                const active = member.status === "active";
                const actionLabel = t("members.actions.menu", { memberName: member.display_name });
                return <Popover
                  ariaLabel={actionLabel}
                  triggerClassName="org-icon-action"
                  trigger={<><Ellipsis size={16} aria-hidden="true" /><span className="org-sr-only">{actionLabel}</span></>}
                >
                  {(dismiss) => <>
                    <Button variant="ghost" disabled={busyID === member.user_id} onClick={() => {
                      dismiss();
                      void updateMember(member, { status: active ? "suspended" : "active" });
                    }}>
                      {active ? <Ban size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                      {active ? t("members.actions.suspend") : t("members.actions.reactivate")}
                    </Button>
                    <Button variant="ghost" className="org-danger" disabled={busyID === member.user_id} onClick={() => {
                      dismiss();
                      setMemberToRemove(member);
                    }}><UserMinus size={16} aria-hidden="true" /> {t("members.actions.remove")}</Button>
                  </>}
                </Popover>;
              } },
            ]}
            data={members}
            rowKey="user_id"
            emptyText={t("members.empty")}
            showColumnVisibility={false}
          />
        </> : tab === "invitations" ? <>
          <div className="org-panel-head"><div><h2>{t("invitations.title")}</h2><p>{t("invitations.description")}</p></div></div>
          <form className="org-invite-form" onSubmit={createInvitation}>
            <Input ref={inviteEmail} label={t("invitations.form.emailLabel")} type="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("invitations.form.emailPlaceholder")} />
            <Select label={t("invitations.form.roleLabel")} value={role} onChange={(event) => setRole(event.target.value)} options={roleOptions.map((value) => ({ value, label: roleLabel(value) }))} />
            <Button variant="primary" type="submit" loading={creating}>
              {creating ? t("invitations.form.creating") : t("invitations.form.createButton")}
            </Button>
          </form>
          <DataTable
            className="org-table"
            aria-label={t("invitations.title")}
            columns={[
              { key: "email", title: t("invitations.columns.email"), render: (_, invitation) => <>
                <strong>{invitation.email}</strong>
                <div className="org-mobile-meta">{renderStatus(invitation.status)} {renderDate(invitation.expires_at)}</div>
              </> },
              { key: "role", title: t("invitations.columns.role"), render: (_, invitation) => <span className="org-label">{roleLabel(invitation.role)}</span> },
              { key: "status", title: t("invitations.columns.status"), render: (_, invitation) => renderStatus(invitation.status) },
              { key: "expires_at", title: t("invitations.columns.expires"), render: (_, invitation) => renderDate(invitation.expires_at) },
              { key: "actions", title: t("invitations.columns.actions"), render: (_, invitation) => invitation.status === "pending" ? (
                <Button className="org-icon-action org-danger" title={t("invitations.actions.revoke")} aria-label={t("invitations.actions.revoke")} disabled={busyID === invitation.id} onClick={() => void revokeInvitation(invitation)}>
                  <X size={16} aria-hidden="true" />
                </Button>
              ) : null },
            ]}
            data={invitations}
            rowKey="id"
            emptyText={t("invitations.empty")}
            showColumnVisibility={false}
          />
        </> : <>
          <div className="org-panel-head"><div><h2>{t("audit.title")}</h2><p>{t("audit.description")}</p></div></div>
          <div className="org-audit-list">
            {events.map((event) => <article key={event.id}>
              <span className="org-audit-icon"><History size={16} aria-hidden="true" /></span>
              <div>
                <strong>{auditActionLabel(event.action)}</strong>
                <p>{t("audit.actor")} <code>{event.actor_user_id}</code> · {t("audit.target")} <code>{event.target_user_id}</code></p>
                <small>{roleLabel(event.before_role || "") || "—"} / {statusLabel(event.before_status)} → {roleLabel(event.after_role || "") || roleLabel(event.before_role || "") || "—"} / {statusLabel(event.after_status)}</small>
              </div>
              {renderDate(event.created_at)}
            </article>)}
            {!events.length && <p className="org-settings-loading">{t("audit.empty")}</p>}
          </div>
        </>}
      </div>
      <ConfirmDialog
        open={Boolean(memberToRemove)}
        title={t("members.confirmRemove.title")}
        description={memberToRemove ? t("members.confirmRemove.description", { memberName: memberToRemove.display_name }) : t("members.confirmRemove.descriptionFallback")}
        confirmText={t("members.confirmRemove.confirmText")}
        danger
        onCancel={() => setMemberToRemove(null)}
        onConfirm={async () => {
          if (!memberToRemove) return;
          await removeMember(memberToRemove);
          setMemberToRemove(null);
        }}
      />
    </>}
  </section>;
}
