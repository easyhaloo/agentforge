import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Clipboard, RefreshCw, UserPlus, Users, ShieldCheck, History, Mail, Ban, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { APIError, organizationAPI, type CreatedInvitation, type MembershipAuditEvent, type OrganizationInvitation, type OrganizationMember, type OrganizationSummary } from "../../shared/api/identity";
import { Button, ConfirmDialog, DataTable, Input, Select, Tabs } from "../../shared/ui";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };
type Tab = "members" | "invitations" | "audit";

const dateTime = (value: string) => new Date(value).toLocaleString();
const statusClass = (status: string) => status === "active" || status === "accepted" ? "status success" : status === "pending" ? "status warning" : "status muted";

export function OrganizationManagementPage({ organization, onNotify }: Props) {
  const { t } = useTranslation("organization");
  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [events, setEvents] = useState<MembershipAuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [busyID, setBusyID] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<OrganizationMember | null>(null);

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
    } catch (cause) {
      const failure = cause instanceof Error ? cause.message : t("feedback.loadFailed");
      setError(failure);
    } finally { setLoading(false); }
  }, [organization.id, canAdmin]);

  useEffect(() => { setCreated(null); void load(); }, [load]);

  const updateMember = async (member: OrganizationMember, update: { role?: string; status?: string }) => {
    setBusyID(member.user_id); setError("");
    try { await organizationAPI.updateMember(organization.id, member.user_id, update); await load(); onNotify(t("feedback.memberUpdated")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("feedback.memberUpdateFailed")); }
    finally { setBusyID(""); }
  };
  const removeMember = async (member: OrganizationMember) => {
    setBusyID(member.user_id); setError("");
    try { await organizationAPI.removeMember(organization.id, member.user_id); await load(); onNotify(t("feedback.memberRemoved")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("feedback.memberRemovalFailed")); }
    finally { setBusyID(""); }
  };
  const createInvitation = async (event: FormEvent) => {
    event.preventDefault(); setCreating(true); setError("");
    try {
      const result = await organizationAPI.createInvitation(organization.id, email.trim(), role);
      setCreated(result); setEmail(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("feedback.invitationCreationFailed")); }
    finally { setCreating(false); }
  };
  const revokeInvitation = async (invitation: OrganizationInvitation) => {
    setBusyID(invitation.id); setError("");
    try { await organizationAPI.revokeInvitation(organization.id, invitation.id); await load(); onNotify(t("feedback.invitationRevoked")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("feedback.invitationRevocationFailed")); }
    finally { setBusyID(""); }
  };
  const copyInvitation = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.invitation_url); onNotify(t("feedback.invitationLinkCopied")); }
    catch { setError(t("feedback.clipboardUnavailable")); }
  };

  if (!canAdmin) return <section className="org-admin card"><div className="org-admin-empty"><ShieldCheck size={26}/><h2>{t("page.restrictedTitle")}</h2><p>{t("page.restrictedDescription", { role: organization.role })}</p></div></section>;

  return <section className="org-admin">
    <div className="org-admin-summary card">
      <div className="org-admin-summary__icon"><Users size={19}/></div>
      <div><h2>{organization.name}</h2><p>{t("page.description")}</p></div>
      <span className="org-role">{organization.role}</span>
      <Button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/> {t("common:actions.refresh")}</Button>
    </div>
    <Tabs
      id="organization-admin"
      value={tab}
      onChange={(value) => setTab(value as Tab)}
      ariaLabel={t("tabs.ariaLabel")}
      className="org-tabs"
      items={[
        { key: "members", label: <><Users size={14}/> {t("tabs.members")} <em>{members.length}</em></> },
        { key: "invitations", label: <><Mail size={14}/> {t("tabs.invitations")} <em>{invitations.length}</em></> },
        { key: "audit", label: <><History size={14}/> {t("tabs.audit")}</> },
      ]}
    />
    {error && <div className="org-error" role="alert">{error}</div>}
    {created && <div className="org-invite-created"><div><b>{t("invitations.created.title")}</b><p>{t("invitations.created.description")}</p></div><code>{created.invitation_url}</code><Button className="button secondary" onClick={()=>void copyInvitation()}><Clipboard size={14}/> {t("invitations.created.copyButton")}</Button><Button variant="ghost" className="org-icon-action" aria-label={t("invitations.created.dismissAriaLabel")} onClick={()=>setCreated(null)}><X size={15}/></Button></div>}
    <div role="tabpanel" id="organization-admin-panel" aria-labelledby={`organization-admin-tab-${tab}`} tabIndex={0}>
    {loading ? <div className="org-loading">{t("page.loading")}</div> : tab==="members" ? <>
      <div className="org-panel-head"><div><h3>{t("members.title")}</h3><p>{t("members.description")}</p></div></div>
      <DataTable
        className="org-table"
        columns={[
          { key: "display_name", title: t("members.columns.member"), render: (_, member) => <><b>{member.display_name}</b><small>{member.email || member.user_id}</small></> },
          { key: "role", title: t("members.columns.role"), render: (_, member) => {
            const manageable = member.status !== "removed" && (organization.role === "owner" || member.role === "member" || member.role === "viewer");
            const roleOptions = organization.role === "owner" ? ["admin", "member", "viewer"] : ["member", "viewer"];
            return <Select aria-label={t("members.actions.roleAriaLabel", { memberName: member.display_name })} value={member.role} disabled={!manageable || busyID === member.user_id} onChange={(event) => void updateMember(member, { role: event.target.value })} options={[...new Set([member.role, ...roleOptions])].map((value) => ({ label: value, value }))} />;
          } },
          { key: "status", title: t("members.columns.status"), render: (_, member) => <span className={statusClass(member.status)}>{member.status}</span> },
          { key: "created_at", title: t("members.columns.joined"), render: (_, member) => dateTime(member.created_at) },
          { key: "actions", title: t("members.columns.actions"), render: (_, member) => {
            const manageable = member.status !== "removed" && (organization.role === "owner" || member.role === "member" || member.role === "viewer");
            return <div className="org-actions">{manageable && <><Button variant="ghost" className="org-icon-action" title={member.status === "active" ? t("members.actions.suspend") : t("members.actions.reactivate")} disabled={busyID === member.user_id} onClick={() => void updateMember(member, { status: member.status === "active" ? "suspended" : "active" })}>{member.status === "active" ? <Ban size={14}/> : <Check size={14}/>}</Button><Button variant="ghost" className="org-icon-action danger" title={t("members.actions.remove")} disabled={busyID === member.user_id} onClick={() => setMemberToRemove(member)}><X size={14}/></Button></>}</div>;
          } },
        ]}
        data={members}
        rowKey="user_id"
        emptyText={t("members.empty")}
        showColumnVisibility={false}
      />
    </> : tab==="invitations" ? <>
      <div className="org-panel-head"><div><h3>{t("invitations.title")}</h3><p>{t("invitations.description")}</p></div></div>
      <form className="org-invite-form" onSubmit={createInvitation}>
        <Input label={t("invitations.form.emailLabel")} type="email" required maxLength={320} value={email} onChange={e=>setEmail(e.target.value)} placeholder={t("invitations.form.emailPlaceholder")}/>
        <Select label={t("invitations.form.roleLabel")} value={role} onChange={e=>setRole(e.target.value)} options={[{label:t("invitations.form.roleOptions.member"),value:"member"},{label:t("invitations.form.roleOptions.viewer"),value:"viewer"},...(organization.role==="owner"?[{label:t("invitations.form.roleOptions.admin"),value:"admin"}]:[])]}/>
        <Button variant="primary" className="button primary" type="submit" disabled={creating}><UserPlus size={14}/>{creating?t("invitations.form.creating"):t("invitations.form.createButton")}</Button>
      </form>
      <DataTable
        className="org-table"
        columns={[
          { key: "email", title: t("invitations.columns.email"), render: (_, invitation) => <b>{invitation.email}</b> },
          { key: "role", title: t("invitations.columns.role"), render: (_, invitation) => invitation.role },
          { key: "status", title: t("invitations.columns.status"), render: (_, invitation) => <span className={statusClass(invitation.status)}>{invitation.status}</span> },
          { key: "expires_at", title: t("invitations.columns.expires"), render: (_, invitation) => dateTime(invitation.expires_at) },
          { key: "actions", title: t("invitations.columns.actions"), render: (_, invitation) => invitation.status === "pending" ? <Button variant="ghost" className="org-icon-action danger" title={t("invitations.actions.revoke")} disabled={busyID === invitation.id} onClick={() => void revokeInvitation(invitation)}><X size={14}/></Button> : null },
        ]}
        data={invitations}
        rowKey="id"
        emptyText={t("invitations.empty")}
        showColumnVisibility={false}
      />
    </> : <>
      <div className="org-panel-head"><div><h3>{t("audit.title")}</h3><p>{t("audit.description")}</p></div></div>
      <div className="org-audit-list">{events.map(event=><article key={event.id}><span className="org-audit-icon"><History size={14}/></span><div><b>{event.action.replaceAll("_"," ")}</b><p>{t("audit.actor")} <code>{event.actor_user_id}</code> · {t("audit.target")} <code>{event.target_user_id}</code></p><small>{event.before_role || "—"} / {event.before_status} → {event.after_role || event.before_role || "—"} / {event.after_status}</small></div><time>{dateTime(event.created_at)}</time></article>)}{!events.length&&<div className="org-empty">{t("audit.empty")}</div>}</div>
    </>}
    </div>
    <ConfirmDialog
      open={Boolean(memberToRemove)}
      title={t("members.confirmRemove.title")}
      description={memberToRemove ? t("members.confirmRemove.description", { memberName: memberToRemove.display_name }) : t("members.confirmRemove.descriptionFallback")}
      confirmText={t("members.confirmRemove.confirmText")}
      danger
      onCancel={() => setMemberToRemove(null)}
      onConfirm={async () => { if (!memberToRemove) return; await removeMember(memberToRemove); setMemberToRemove(null); }}
    />
  </section>;
}
