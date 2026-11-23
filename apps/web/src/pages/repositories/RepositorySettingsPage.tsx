import { useEffect, useState } from "react";
import { GitBranch, KeyRound, Settings, Tag } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { repositoryAPI, repositoryGitAPI, type GitCredentialSummary, repositoryPreviewAPI, type OrganizationSummary, type RepositoryMetadata, type RepositoryPreviewRefs } from "../../shared/api/identity";
import { useDateFormatting } from "../../shared/i18n/format";
import { translateError } from "../../shared/api/errors";
import { organizationHandle, repositoryNewPath, repositoryPath, repositorySettingsPath, type RepositorySettingsSection } from "../../shared/routing";
import { Button, Checkbox, Input, Modal, Select } from "../../shared/ui";
import { canManageRepository } from "./repositoryPermissions";
import { RepositoryCloneDialog } from "./RepositoryCloneDialog";
import "./repositories.css";
import "./repository-settings.css";

type Props = { organization: OrganizationSummary; repository: string; section: RepositorySettingsSection; onNotify: (message: string) => void };

export function RepositorySettingsPage({ organization, repository, section }: Props) {
  const { t } = useTranslation("repositories");
  const [refs, setRefs] = useState<RepositoryPreviewRefs>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const handle = organizationHandle(organization);
  const path = (panel: RepositorySettingsSection) => repositorySettingsPath(handle, repository, panel);

  useEffect(() => {
    let active = true;
    void repositoryPreviewAPI.refs(organization.id, repository)
      .then(result => { if (active) setRefs(result); })
      .catch(cause => { if (active) setError(translateError(cause, t, "repositories:browser.refsFailed")); });
    return () => { active = false; };
  }, [organization.id, repository, t, attempt]);

  const title = t({ general: "settings.general", branches: "sections.branches", tags: "settings.tags", "git-tokens": "git.tokens" }[section]);
  return <div className="repo-layout repo-browser repo-settings">
    <nav className="repo-settings-nav" aria-label={t("sections.settingsFor", { repository })}>
      <NavLink to={path("general")} end><Settings size={16} aria-hidden="true"/>{t("settings.general")}</NavLink>
      {refs?.git_credentials_available && <div className="repo-settings-nav-group">
        <p>{t("settings.access")}</p>
        <NavLink to={path("git-tokens")} end><KeyRound size={16} aria-hidden="true"/>{t("git.tokens")}</NavLink>
      </div>}
      <div className="repo-settings-nav-group">
        <p>{t("settings.sourceControl")}</p>
        <NavLink to={path("branches")} end><GitBranch size={16} aria-hidden="true"/>{t("sections.branches")}</NavLink>
        <NavLink to={path("tags")} end><Tag size={16} aria-hidden="true"/>{t("settings.tags")}</NavLink>
      </div>
    </nav>
    <section className="repo-settings-content" aria-labelledby="repository-settings-title">
      <header className="repo-settings-heading">
        <h1 id="repository-settings-title">{title}</h1>
      </header>
      {error && <div className="repo-settings-card">
        <p role="alert" className="org-error">{error}</p>
        <Button onClick={() => { setError(""); setAttempt(attempt + 1); }}>{t("app:organizationGate.retry")}</Button>
      </div>}
      {!refs && !error && <p role="status">{t("common:components.loading")}</p>}
      {refs && section === "general" && <>
        <section className="repo-settings-card">
          <h2>{t("settings.repositoryName")}</h2>
          <Link className="repo-link" to={repositoryPath(handle, repository)}>{refs.repository}</Link>
          <GeneralSettings organization={organization} refs={refs} onSave={item => setRefs(current => current && {
            ...current, description: item.description, is_template: item.is_template, push_ref_limit: item.push_ref_limit, updated_at: item.updated_at,
          })} />
        </section>
        <DefaultBranchSettings organization={organization} repository={repository} refs={refs}
          onSave={branch => {
            setRefs(current => current && { ...current, default_branch: branch });
            setAttempt(current => current + 1);
          }} />
      </>}
      {refs && (section === "branches" || section === "tags") && <RepositoryRefList kind={section === "branches" ? "branch" : "tag"}
        refs={refs} codePath={repositoryPath(handle, repository)} />}
      {refs && section === "git-tokens" && <div className="repo-settings-card">
        {refs.git_credentials_available ? <RepositoryCredentials organization={organization} repository={repository} />
          : <p>{t("settings.tokensUnavailable")}</p>}
      </div>}
    </section>
  </div>;
}

function GeneralSettings({ organization, refs, onSave }: {
  organization: OrganizationSummary; refs: RepositoryPreviewRefs; onSave: (item: RepositoryMetadata) => void;
}) {
  const { t } = useTranslation("repositories");
  const [draft, setDraft] = useState<string>();
  const [pushLimitDraft, setPushLimitDraft] = useState<string>();
  const [template, setTemplate] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const description = draft ?? refs.description ?? "";
  const isTemplate = template ?? Boolean(refs.is_template);
  const pushLimit = pushLimitDraft ?? String(refs.push_ref_limit ?? 0);
  const pushLimitValue = Number(pushLimit);
  const validPushLimit = pushLimit !== "" && (pushLimitValue === 0 ||
    (Number.isInteger(pushLimitValue) && pushLimitValue >= 2 && pushLimitValue <= 128));
  const changed = description.trim() !== (refs.description ?? "") || isTemplate !== Boolean(refs.is_template) || pushLimitValue !== (refs.push_ref_limit ?? 0);
  const canEdit = canManageRepository(organization) && Boolean(refs.updated_at);
  const useTemplate = `${repositoryNewPath(organizationHandle(organization))}?${new URLSearchParams({ template: refs.repository })}`;

  const save = async () => {
    if (!canEdit || !refs.updated_at || !changed || !validPushLimit || busy) return;
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      const item = await repositoryAPI.updateGeneralSettings(organization.id, refs.repository, {
        description: description.trim(), is_template: isTemplate, updated_at: refs.updated_at,
        ...(refs.git_credentials_available ? { push_ref_limit: pushLimitValue } : {}),
      });
      onSave(item);
      setDraft(undefined);
      setTemplate(undefined);
      setPushLimitDraft(undefined);
      setSaved(true);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:sections.settingsFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) return refs.description ? <p>{refs.description}</p> : null;
  return <form className="repo-settings-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <Input label={t("settings.description")} value={description} disabled={busy}
      onChange={event => { setDraft(Array.from(event.target.value).slice(0, 350).join("")); setSaved(false); }} />
    {refs.hosting_kind === "hosted" && <>
      <Checkbox label={t("settings.templateRepository")} checked={isTemplate} disabled={busy}
        onChange={event => { setTemplate(event.target.checked); setSaved(false); }} />
      <p>{t("settings.templateHelp")}</p>
    </>}
    {refs.git_credentials_available && <>
      <h3 className="repo-settings-subheading">{t("settings.pushes")}</h3>
      <Checkbox label={t("settings.limitPushRefs")} checked={pushLimit !== "0"} disabled={busy} onChange={event => {
        setPushLimitDraft(event.target.checked ? "5" : "0");
        setSaved(false);
      }} />
      {pushLimit !== "0" && <Input label={t("settings.maxPushRefs")} type="number" min={2} max={128} required
        value={pushLimit} disabled={busy} onChange={event => { setPushLimitDraft(event.target.value); setSaved(false); }} />}
      <p>{t("settings.pushLimitHelp")}</p>
    </>}
    <div className="repo-settings-controls">
      <Button type="submit" variant="primary" disabled={busy || !changed || !validPushLimit}>{t("common:actions.save")}</Button>
      {refs.is_template && <Link className="repo-link" to={useTemplate}>{t("settings.useTemplate")}</Link>}
    </div>
    {saved && <p role="status">{t("settings.generalSaved")}</p>}
    {error && <p role="alert" className="org-error">{error}</p>}
  </form>;
}

function DefaultBranchSettings({ organization, repository, refs, onSave }: {
  organization: OrganizationSummary; repository: string; refs: RepositoryPreviewRefs; onSave: (branch: string) => void;
}) {
  const { t } = useTranslation("repositories");
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const branches = refs.items.filter(ref => ref.kind === "branch" && (refs.hosting_kind !== "hosted" || (ref.name !== "agentforge" && !ref.name.startsWith("agentforge/"))));
  const hosted = refs.hosting_kind === "hosted";
  const canEdit = canManageRepository(organization);
  const canSave = draft !== undefined && draft !== refs.default_branch && branches.some(ref => ref.name === draft);

  const save = async () => {
    if (busy || !canEdit || !canSave) return;
    setBusy(true);
    setError("");
    try {
      await repositoryAPI.updateDefaultBranch(organization.id, repository, draft, refs.default_branch);
      onSave(draft);
      setDraft(undefined);
      setConfirm(false);
      setSaved(true);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:sections.settingsFailed"));
    } finally {
      setBusy(false);
    }
  };

  return <section className="repo-settings-card">
    <h2>{t("sections.defaultBranch")}</h2>
    <p>{t("sections.defaultBranchHelp")}</p>
    <div className="repo-settings-controls">
      <code className="repo-settings-branch"><GitBranch size={15} aria-hidden="true"/>{refs.default_branch}</code>
      {hosted && <span className="repo-section-badge">{t("settings.protected")}</span>}
      {canEdit && draft === undefined && branches.some(ref => ref.name !== refs.default_branch) && <Button onClick={() => {
        setDraft(refs.default_branch);
        setSaved(false);
      }}>{t("settings.changeDefaultBranch")}</Button>}
    </div>
    {hosted && <p>{t("git.protectedBranch", { branch: refs.default_branch })}</p>}
    {!canEdit && <p>{t("sections.settingsDenied")}</p>}
    {canEdit && draft !== undefined && <form className="repo-settings-form" onSubmit={event => { event.preventDefault(); if (canSave) setConfirm(true); }}>
      <Select label={t("settings.newDefaultBranch")} autoFocus value={draft} disabled={busy} onChange={event => setDraft(event.target.value)}
        options={branches.map(ref => ({ value: ref.name, label: ref.name }))} />
      <div className="repo-settings-controls">
        <Button type="submit" variant="primary" disabled={busy || !canSave}>{t("common:actions.save")}</Button>
        <Button disabled={busy} onClick={() => { setDraft(undefined); setError(""); }}>{t("common:actions.cancel")}</Button>
      </div>
    </form>}
    {saved && <p role="status">{t("sections.settingsSaved")}</p>}
    {!confirm && error && <p role="alert" className="org-error">{error}</p>}
    <Modal open={confirm} title={t("settings.changeDefaultBranch")}
      cancelText={t("common:actions.cancel")} okText={t("settings.confirmDefaultBranch")}
      okDisabled={busy || !canSave} onCancel={() => { if (!busy) setConfirm(false); }} onOk={save}>
      <p>{t("settings.defaultBranchWarning", { previous: refs.default_branch, branch: draft })}</p>
      {error && <p role="alert" className="org-error">{error}</p>}
    </Modal>
  </section>;
}

function RepositoryRefList({ kind, refs, codePath }: { kind: "branch" | "tag"; refs: RepositoryPreviewRefs; codePath: string }) {
  const { t } = useTranslation("repositories");
  const items = refs.items.filter(ref => ref.kind === kind);
  const Icon = kind === "branch" ? GitBranch : Tag;
  const prefix = kind === "branch" ? "refs/heads" : "refs/tags";
  return <div className="repo-settings-card repo-settings-refs">
    {items.length > 0 ? <ul className="repo-section-list">
      {items.map(ref => <li key={ref.name}>
        <Link className="repo-link" to={`${codePath}?${new URLSearchParams({ ref: `${prefix}/${ref.name}` })}`}>
          <Icon size={16} aria-hidden="true"/>{ref.name}
        </Link>
        {kind === "branch" && ref.name === refs.default_branch && <span className="repo-section-badge">{t("sections.default")}</span>}
        <code>{ref.sha.slice(0, 7)}</code>
      </li>)}
    </ul> : <p>{t(kind === "branch" ? "sections.noBranches" : "settings.noTags")}</p>}
  </div>;
}

function RepositoryCredentials({ organization, repository }: { organization: OrganizationSummary; repository: string }) {
  const { t } = useTranslation("repositories");
  const { formatDateTime } = useDateFormatting();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [items, setItems] = useState<GitCredentialSummary[]>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void repositoryGitAPI.listCredentials(organization.id, repository, controller.signal)
      .then(result => { if (!controller.signal.aborted) setItems(result.items); })
      .catch(cause => { if (!controller.signal.aborted) setError(translateError(cause, t, "repositories:git.failed")); });
    return () => controller.abort();
  }, [organization.id, repository, attempt, t]);

  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      await repositoryGitAPI.revokeCredential(organization.id, repository, id);
      setAttempt(current => current + 1);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:git.failed"));
    } finally { setBusy(false); }
  }

  return <>
    <Button onClick={() => setDialogOpen(true)}>{t("git.manage")}</Button>
    <RepositoryCloneDialog key={attempt} open={dialogOpen} onClose={() => {
      setDialogOpen(false);
      setError("");
      setAttempt(current => current + 1);
    }} organization={organization} repository={repository} />
    {error && <div role="alert">
      <p className="org-error">{error}</p>
      <Button onClick={() => { setError(""); setAttempt(current => current + 1); }}>{t("app:organizationGate.retry")}</Button>
    </div>}
    {!items && !error && <p role="status">{t("common:components.loading")}</p>}
    {items?.length === 0 && <p>{t("git.empty")}</p>}
    {items && items.length > 0 && <ul className="repo-section-list">
      {items.map(item => <li key={item.id}>
        <div><strong>{t(item.scope === "read" ? "git.read" : "git.write")}</strong>
          <p>{t("git.expires", { date: formatDateTime(item.expires_at) })}</p>
        </div>
        <Button disabled={busy} onClick={() => void revoke(item.id)}>{t("clone.revoke")}</Button>
      </li>)}
    </ul>}
  </>;
}
