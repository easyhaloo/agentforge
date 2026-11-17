import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Clipboard, RefreshCw, UserPlus, Users, ShieldCheck, History, Mail, Ban, Check, X } from "lucide-react";
import { APIError, organizationAPI, type CreatedInvitation, type MembershipAuditEvent, type OrganizationInvitation, type OrganizationMember, type OrganizationSummary } from "../../shared/api/identity";
import { Button, ConfirmDialog, Input, Select, Tabs } from "../../shared/ui";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };
type Tab = "members" | "invitations" | "audit";

const dateTime = (value: string) => new Date(value).toLocaleString();
const statusClass = (status: string) => status === "active" || status === "accepted" ? "status success" : status === "pending" ? "status warning" : "status muted";

export function OrganizationManagementPage({ organization, onNotify }: Props) {
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
      const failure = cause instanceof Error ? cause.message : "Unable to load organization data";
      setError(failure);
    } finally { setLoading(false); }
  }, [organization.id, canAdmin]);

  useEffect(() => { setCreated(null); void load(); }, [load]);

  const updateMember = async (member: OrganizationMember, update: { role?: string; status?: string }) => {
    setBusyID(member.user_id); setError("");
    try { await organizationAPI.updateMember(organization.id, member.user_id, update); await load(); onNotify("Member updated."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Member update failed"); }
    finally { setBusyID(""); }
  };
  const removeMember = async (member: OrganizationMember) => {
    setBusyID(member.user_id); setError("");
    try { await organizationAPI.removeMember(organization.id, member.user_id); await load(); onNotify("Member removed."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Member removal failed"); }
    finally { setBusyID(""); }
  };
  const createInvitation = async (event: FormEvent) => {
    event.preventDefault(); setCreating(true); setError("");
    try {
      const result = await organizationAPI.createInvitation(organization.id, email.trim(), role);
      setCreated(result); setEmail(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Invitation creation failed"); }
    finally { setCreating(false); }
  };
  const revokeInvitation = async (invitation: OrganizationInvitation) => {
    setBusyID(invitation.id); setError("");
    try { await organizationAPI.revokeInvitation(organization.id, invitation.id); await load(); onNotify("Invitation revoked."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Invitation revocation failed"); }
    finally { setBusyID(""); }
  };
  const copyInvitation = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.invitation_url); onNotify("Invitation link copied."); }
    catch { setError("Clipboard access is unavailable. Select and copy the invitation URL manually."); }
  };

  if (!canAdmin) return <section className="org-admin card"><div className="org-admin-empty"><ShieldCheck size={26}/><h2>Organization administration restricted</h2><p>Your current role is <b>{organization.role}</b>. Only organization Owners and Admins can view members, invitations and audit history.</p></div></section>;

  return <section className="org-admin">
    <div className="org-admin-summary card">
      <div className="org-admin-summary__icon"><Users size={19}/></div>
      <div><h2>{organization.name}</h2><p>Organization access, invitations and membership activity</p></div>
      <span className="org-role">{organization.role}</span>
      <Button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/> Refresh</Button>
    </div>
    <Tabs
      id="organization-admin"
      value={tab}
      onChange={(value) => setTab(value as Tab)}
      ariaLabel="Organization administration"
      className="org-tabs"
      items={[
        { key: "members", label: <><Users size={14}/> Members <em>{members.length}</em></> },
        { key: "invitations", label: <><Mail size={14}/> Invitations <em>{invitations.length}</em></> },
        { key: "audit", label: <><History size={14}/> Audit history</> },
      ]}
    />
    {error && <div className="org-error" role="alert">{error}</div>}
    {created && <div className="org-invite-created"><div><b>Invitation created</b><p>This one-time link is shown only now. Send it through your approved secure channel.</p></div><code>{created.invitation_url}</code><Button className="button secondary" onClick={()=>void copyInvitation()}><Clipboard size={14}/> Copy link</Button><Button variant="ghost" className="org-icon-action" aria-label="Dismiss invitation link" onClick={()=>setCreated(null)}><X size={15}/></Button></div>}
    <div role="tabpanel" id="organization-admin-panel" aria-labelledby={`organization-admin-tab-${tab}`} tabIndex={0}>
    {loading ? <div className="org-loading">Loading organization data…</div> : tab==="members" ? <>
      <div className="org-panel-head"><div><h3>Organization members</h3><p>Role and status changes are enforced by the server.</p></div></div>
      <div className="org-table-wrap"><table className="org-table"><thead><tr><th>MEMBER</th><th>ROLE</th><th>STATUS</th><th>JOINED</th><th>ACTIONS</th></tr></thead><tbody>
        {members.map(member => {
          const manageable = member.status!=="removed" && (organization.role==="owner" || member.role==="member" || member.role==="viewer");
          const roleOptions = organization.role==="owner" ? ["admin","member","viewer"] : ["member","viewer"];
          return <tr key={member.user_id}><td><b>{member.display_name}</b><small>{member.email || member.user_id}</small></td><td><Select aria-label={`Role for ${member.display_name}`} value={member.role} disabled={!manageable || busyID===member.user_id} onChange={e=>void updateMember(member,{role:e.target.value})} options={[...new Set([member.role,...roleOptions])].map(value=>({label:value,value}))}/></td><td><span className={statusClass(member.status)}>{member.status}</span></td><td>{dateTime(member.created_at)}</td><td><div className="org-actions">{manageable && member.status!=="removed" && <><Button variant="ghost" className="org-icon-action" title={member.status==="active"?"Suspend member":"Reactivate member"} disabled={busyID===member.user_id} onClick={()=>void updateMember(member,{status:member.status==="active"?"suspended":"active"})}>{member.status==="active"?<Ban size={14}/>:<Check size={14}/>}</Button><Button variant="ghost" className="org-icon-action danger" title="Remove member" disabled={busyID===member.user_id} onClick={()=>setMemberToRemove(member)}><X size={14}/></Button></>}</div></td></tr>;
        })}
        {!members.length && <tr><td colSpan={5} className="org-empty">No organization members found.</td></tr>}
      </tbody></table></div>
    </> : tab==="invitations" ? <>
      <div className="org-panel-head"><div><h3>Invitations</h3><p>Pending invitations expire after seven days and can only be redeemed once.</p></div></div>
      <form className="org-invite-form" onSubmit={createInvitation}>
        <Input label="Email address" type="email" required maxLength={320} value={email} onChange={e=>setEmail(e.target.value)} placeholder="teammate@company.com"/>
        <Select label="Role" value={role} onChange={e=>setRole(e.target.value)} options={[{label:"Member",value:"member"},{label:"Viewer",value:"viewer"},...(organization.role==="owner"?[{label:"Admin",value:"admin"}]:[])]}/>
        <Button variant="primary" className="button primary" type="submit" disabled={creating}><UserPlus size={14}/>{creating?"Creating…":"Create invitation"}</Button>
      </form>
      <div className="org-table-wrap"><table className="org-table"><thead><tr><th>EMAIL</th><th>ROLE</th><th>STATUS</th><th>EXPIRES</th><th>ACTIONS</th></tr></thead><tbody>
        {invitations.map(invitation=><tr key={invitation.id}><td><b>{invitation.email}</b></td><td>{invitation.role}</td><td><span className={statusClass(invitation.status)}>{invitation.status}</span></td><td>{dateTime(invitation.expires_at)}</td><td>{invitation.status==="pending"&&<Button variant="ghost" className="org-icon-action danger" title="Revoke invitation" disabled={busyID===invitation.id} onClick={()=>void revokeInvitation(invitation)}><X size={14}/></Button>}</td></tr>)}
        {!invitations.length && <tr><td colSpan={5} className="org-empty">No invitations found.</td></tr>}
      </tbody></table></div>
    </> : <>
      <div className="org-panel-head"><div><h3>Membership audit history</h3><p>Newest membership and invitation events first.</p></div></div>
      <div className="org-audit-list">{events.map(event=><article key={event.id}><span className="org-audit-icon"><History size={14}/></span><div><b>{event.action.replaceAll("_"," ")}</b><p>Actor <code>{event.actor_user_id}</code> · Target <code>{event.target_user_id}</code></p><small>{event.before_role || "—"} / {event.before_status} → {event.after_role || event.before_role || "—"} / {event.after_status}</small></div><time>{dateTime(event.created_at)}</time></article>)}{!events.length&&<div className="org-empty">No audit events recorded yet.</div>}</div>
    </>}
    </div>
    <ConfirmDialog
      open={Boolean(memberToRemove)}
      title="Remove organization member?"
      description={memberToRemove ? `Remove ${memberToRemove.display_name} from this organization? This action cannot be undone.` : "This action cannot be undone."}
      confirmText="Remove member"
      danger
      onCancel={() => setMemberToRemove(null)}
      onConfirm={async () => { if (!memberToRemove) return; await removeMember(memberToRemove); setMemberToRemove(null); }}
    />
  </section>;
}
