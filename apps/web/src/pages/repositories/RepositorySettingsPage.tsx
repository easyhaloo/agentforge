import { useEffect, useState } from "react";
import { GitBranch, KeyRound, Play, Scale, Settings, Tag } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { repositoryAPI, repositoryGitAPI, type GitCredentialSummary, repositoryPreviewAPI, type OrganizationSummary, type RepositoryMetadata, type RepositoryPreviewRefs } from "../../shared/api/identity";
import { useDateFormatting } from "../../shared/i18n/format";
import { translateError } from "../../shared/api/errors";
import { organizationHandle, repositoryNewPath, repositoryPath, repositorySettingsPath, type RepositorySettingsSection } from "../../shared/routing";
import { Button, Checkbox, Input, Modal, Select, TextArea } from "../../shared/ui";
import { canManageRepository, repositoryIssuesSettingChanged } from "./repositoryPermissions";
import { RepositoryCloneDialog } from "./RepositoryCloneDialog";
import { RepositoryRulesetsSettings } from "./RepositoryRulesetsSettings";
import "./repositories.css";
import "./repository-settings.css";

type Props = { organization: OrganizationSummary; repository: string; section: RepositorySettingsSection; onNotify: (message: string) => void };

export function RepositorySettingsPage({ organization, repository, section }: Props) {
  const { t } = useTranslation("repositories");
  const [refs, setRefs] = useState<RepositoryPreviewRefs>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const isActions = section === "actions";
  const needsRefs = !isActions && section !== "rulesets";
  const handle = organizationHandle(organization);
  const path = (panel: RepositorySettingsSection) => repositorySettingsPath(handle, repository, panel);

  useEffect(() => {
    let active = true;
    void repositoryPreviewAPI.refs(organization.id, repository)
      .then(result => { if (active) setRefs(result); })
      .catch(cause => { if (active) setError(translateError(cause, t, "repositories:browser.refsFailed")); });
    return () => { active = false; };
  }, [organization.id, repository, t, attempt]);

  const title = t({ general: "settings.general", rulesets: "settings.rulesets.title", branches: "sections.branches", tags: "settings.tags", actions: "sections.actions", "git-tokens": "git.tokens" }[section]);
  return <div className="repo-layout repo-browser repo-settings">
    <nav className="repo-settings-nav" aria-label={t("sections.settingsFor", { repository })}>
      <NavLink to={path("general")} end><Settings size={16} aria-hidden="true"/>{t("settings.general")}</NavLink>
      {refs?.git_credentials_available && <div className="repo-settings-nav-group">
        <p>{t("settings.access")}</p>
        <NavLink to={path("git-tokens")} end><KeyRound size={16} aria-hidden="true"/>{t("git.tokens")}</NavLink>
      </div>}
      <div className="repo-settings-nav-group">
        <p>{t("settings.sourceControl")}</p>
        <NavLink to={path("rulesets")} end><Scale size={16} aria-hidden="true"/>{t("settings.rulesets.title")}</NavLink>
        <NavLink to={path("branches")} end><GitBranch size={16} aria-hidden="true"/>{t("sections.branches")}</NavLink>
        <NavLink to={path("tags")} end><Tag size={16} aria-hidden="true"/>{t("settings.tags")}</NavLink>
      </div>
      <div className="repo-settings-nav-group">
        <NavLink to={path("actions")} end><Play size={16} aria-hidden="true"/>{t("sections.actions")}</NavLink>
      </div>
    </nav>
    <section className="repo-settings-content" aria-labelledby="repository-settings-title">
      <header className="repo-settings-heading">
        <h1 id="repository-settings-title">{title}</h1>
      </header>
      {needsRefs && error && <div className="repo-settings-card">
        <p role="alert" className="org-error">{error}</p>
        <Button onClick={() => { setError(""); setAttempt(attempt + 1); }}>{t("app:organizationGate.retry")}</Button>
      </div>}
      {needsRefs && !refs && !error && <p role="status">{t("common:components.loading")}</p>}
      {refs && section === "general" && <>
        <section className="repo-settings-card">
          <h2>{t("settings.repositoryName")}</h2>
          <Link className="repo-link" to={repositoryPath(handle, repository)}>{refs.repository}</Link>
          <GeneralSettings organization={organization} refs={refs} onSave={item => setRefs(current => current && {
            ...current, description: item.description, delete_merged_branches: item.delete_merged_branches, issues_disabled: item.issues_disabled, is_template: item.is_template, push_ref_limit: item.push_ref_limit, updated_at: item.updated_at,
          })} />
        </section>
        <DefaultBranchSettings organization={organization} repository={repository} refs={refs}
          onSave={branch => {
            setRefs(current => current && { ...current, default_branch: branch });
            setAttempt(current => current + 1);
          }} />
      </>}
      {section === "rulesets" && <RepositoryRulesetsSettings organization={organization} repository={repository} />}
      {refs && (section === "branches" || section === "tags") && <>
        {refs.hosting_kind === "hosted" && <RefProtectionSettings key={section} section={section} organization={organization} refs={refs}
          onSave={item => setRefs(current => current && { ...current, protected_refs: item.protected_refs, updated_at: item.updated_at })} />}
        <RepositoryRefList kind={section === "branches" ? "branch" : "tag"} refs={refs} codePath={repositoryPath(handle, repository)} />
      </>}
      {isActions && <ActionsSettings organization={organization} repository={repository} onSave={() => {
        setRefs(undefined);
        setError("");
        setAttempt(current => current + 1);
      }} />}
      {refs && section === "git-tokens" && <div className="repo-settings-card">
        {refs.git_credentials_available ? <RepositoryCredentials organization={organization} repository={repository} />
          : <p>{t("settings.tokensUnavailable")}</p>}
      </div>}
    </section>
  </div>;
}

function ActionsSettings({ organization, repository, onSave }: {
  organization: OrganizationSummary; repository: string; onSave: () => void;
}) {
  const { t } = useTranslation("repositories");
  const [draft, setDraft] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<RepositoryMetadata>();
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    void repositoryAPI.settings(organization.id, repository)
      .then(result => { if (active) setSettings(result); })
      .catch(cause => { if (active) setLoadError(translateError(cause, t, "sections.settingsFailed")); });
    return () => { active = false; };
  }, [organization.id, repository, retry, t]);

  const actionsDisabled = settings?.actions_disabled ?? false;
  const selected = draft ?? actionsDisabled;
  const canManage = canManageRepository(organization);
  const canSave = canManage && !busy && Boolean(settings) && selected !== actionsDisabled;

  async function save() {
    if (!canSave || !settings) return;
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      setSettings(await repositoryAPI.updateGeneralSettings(organization.id, repository, {
        actions_disabled: selected, updated_at: settings.updated_at,
      }));
      onSave();
      setDraft(undefined);
      setSaved(true);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:sections.settingsFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <div className="repo-settings-card">
    <p role="alert" className="org-error">{loadError}</p>
    <Button onClick={() => { setLoadError(""); setRetry(current => current + 1); }}>{t("app:organizationGate.retry")}</Button>
  </div>;
  if (!settings) return <p role="status">{t("common:components.loading")}</p>;

  return <section className="repo-settings-card">
    <h2>{t("settings.actionsRuns")}</h2>
    <form className="repo-settings-form" aria-busy={busy} onSubmit={event => { event.preventDefault(); void save(); }}>
      <Select label={t("settings.actionsAvailability")} value={selected ? "disabled" : "enabled"}
        options={[
          { value: "enabled", label: t("settings.actionsEnabled") },
          { value: "disabled", label: t("settings.actionsDisabled") },
        ]} hint={t("settings.actionsHelp")} disabled={!canManage || busy}
        onChange={event => { setDraft(event.target.value === "disabled"); setSaved(false); setError(""); }} />
      {canManage ? <Button type="submit" variant="primary" disabled={!canSave}>{t("common:actions.save")}</Button>
        : <p>{t("sections.settingsDenied")}</p>}
      {saved && <p role="status">{t("settings.actionsSaved")}</p>}
      {error && <p role="alert" className="org-error">{error}</p>}
    </form>
  </section>;
}

function GeneralSettings({ organization, refs, onSave }: {
  organization: OrganizationSummary; refs: RepositoryPreviewRefs; onSave: (item: RepositoryMetadata) => void;
}) {
  const { t } = useTranslation("repositories");
  const [draft, setDraft] = useState<string>();
  const [pushLimitDraft, setPushLimitDraft] = useState<string>();
  const [template, setTemplate] = useState<boolean>();
  const [issuesDraft, setIssuesDraft] = useState<boolean>();
  const [deleteBranchesDraft, setDeleteBranchesDraft] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const description = draft ?? refs.description ?? "";
  const isTemplate = template ?? Boolean(refs.is_template);
  const deleteBranches = deleteBranchesDraft ?? Boolean(refs.delete_merged_branches);
  const issuesEnabled = issuesDraft ?? !refs.issues_disabled;
  const pushLimit = pushLimitDraft ?? String(refs.push_ref_limit ?? 0);
  const pushLimitValue = Number(pushLimit);
  const validPushLimit = pushLimit !== "" && (pushLimitValue === 0 ||
    (Number.isInteger(pushLimitValue) && pushLimitValue >= 2 && pushLimitValue <= 128));
  const changed = description.trim() !== (refs.description ?? "") || isTemplate !== Boolean(refs.is_template) || pushLimitValue !== (refs.push_ref_limit ?? 0) || issuesEnabled === Boolean(refs.issues_disabled) || deleteBranches !== Boolean(refs.delete_merged_branches);
  const canEdit = canManageRepository(organization) && Boolean(refs.updated_at);
  const useTemplate = `${repositoryNewPath(organizationHandle(organization))}?${new URLSearchParams({ template: refs.repository })}`;

  const save = async () => {
    if (!canEdit || !refs.updated_at || !changed || !validPushLimit || busy) return;
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      const item = await repositoryAPI.updateGeneralSettings(organization.id, refs.repository, {
        description: description.trim(), is_template: isTemplate, issues_disabled: !issuesEnabled, updated_at: refs.updated_at,
        ...(refs.hosting_kind === "hosted" ? { delete_merged_branches: deleteBranches } : {}),
        ...(refs.git_credentials_available ? { push_ref_limit: pushLimitValue } : {}),
      });
      onSave(item);
      if (item.issues_disabled !== refs.issues_disabled) window.dispatchEvent(new Event(repositoryIssuesSettingChanged));
      setIssuesDraft(undefined);
      setDeleteBranchesDraft(undefined);
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
    <h3 className="repo-settings-subheading">{t("settings.features")}</h3>
    <Checkbox label={t("sections.issues")} checked={issuesEnabled} disabled={busy}
      onChange={event => { setIssuesDraft(event.target.checked); setSaved(false); }} />
    <p>{t("settings.issuesHelp")}</p>
    {refs.hosting_kind === "hosted" && <>
      <h3 className="repo-settings-subheading">{t("settings.pullRequests")}</h3>
      <Checkbox label={t("settings.deleteMergedBranches")} checked={deleteBranches} disabled={busy}
        onChange={event => { setDeleteBranchesDraft(event.target.checked); setSaved(false); }} />
      <p>{t("settings.deleteMergedBranchesHelp")}</p>
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

function RefProtectionSettings({ section, organization, refs, onSave }: {
  section: "branches" | "tags"; organization: OrganizationSummary; refs: RepositoryPreviewRefs; onSave: (item: RepositoryMetadata) => void;
}) {
  const { t } = useTranslation("repositories");
  const prefix = section === "branches" ? "refs/heads/" : "refs/tags/";
  const existing = (refs.protected_refs ?? []).filter(pattern => pattern.startsWith(prefix));
  const savedValue = existing.map(pattern => pattern.slice(prefix.length)).join("\n");
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const value = draft ?? savedValue;
  const canEdit = canManageRepository(organization);
  const save = async () => {
    if (!canEdit || !refs.updated_at || busy || value === savedValue) return;
    const patterns = value.split("\n").map(pattern => pattern.trim()).filter(Boolean).map(pattern => prefix + pattern);
    const other = (refs.protected_refs ?? []).filter(pattern => !pattern.startsWith(prefix));
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      onSave(await repositoryAPI.updateGeneralSettings(organization.id, refs.repository, {
        protected_refs: [...other, ...patterns], updated_at: refs.updated_at,
      }));
      setDraft(undefined);
      setSaved(true);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:sections.settingsFailed"));
    } finally {
      setBusy(false);
    }
  };

  return <form className="repo-settings-card repo-settings-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h2>{t("settings.refProtection")}</h2>
    <TextArea rows={3} label={t("settings.protectedPatterns")} hint={t("settings.protectedPatternsHelp", { example: section === "branches" ? "release/*" : "v*" })}
      value={value} maxLength={2580} readOnly={!canEdit} disabled={busy} onChange={event => { setDraft(event.target.value); setSaved(false); }} />
    {canEdit ? <div className="repo-settings-controls">
      <Button type="submit" variant="primary" disabled={busy || !refs.updated_at || value === savedValue}>{t("common:actions.save")}</Button>
    </div> : <p>{t("sections.settingsDenied")}</p>}
    {saved && <p role="status">{t("sections.settingsSaved")}</p>}
    {error && <p role="alert" className="org-error">{error}</p>}
  </form>;
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
