import { useEffect, useState } from "react";
import { GitBranch, Workflow } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { repositoryAPI, repositoryPreviewAPI, type OrganizationSummary, type RepositoryPreviewRefs } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { formatDateTime } from "../../shared/i18n/format";
import { organizationHandle, pipelineRunPath, repositoryPath, type RepositorySection } from "../../shared/routing";
import { Button, Select } from "../../shared/ui";
import { RepositoryMasthead, canManageRepository } from "./RepositoryMasthead";
import { RepositoryIssues } from "./RepositoryIssues";
import "./repositories.css";

type Props = { organization: OrganizationSummary; repository: string; section: RepositorySection; onNotify: (message: string) => void };

export function RepositorySectionPage({ organization, repository, section, currentUser, onNotify }: Props & { currentUser: string }) {
  const { t } = useTranslation("repositories");
  const props = { organization, repository, section, onNotify };
  const handle = organizationHandle(organization);
  return <section className="repo-layout repo-browser">
    <RepositoryMasthead organization={organization} repository={repository} />
    {section === "issues" ? (
      <RepositoryIssues organization={organization} repository={repository} organizationHandle={handle} currentUser={currentUser} onNotify={onNotify} />
    ) : (
      <div className="repo-panel repo-section-content">
        <h2>{t(`sections.${section}`)}</h2>
        {section === "actions" ? <RepositoryActions {...props}/>
          : section === "settings" && !canManageRepository(organization) ? <p role="alert">{t("sections.settingsDenied")}</p>
          : <RepositoryBranches {...props}/>}
      </div>
    )}
  </section>;
}

function RepositoryBranches({ organization, repository, section, onNotify }: Props) {
  const { t } = useTranslation("repositories");
  const [refs, setRefs] = useState<RepositoryPreviewRefs>();
  const [branch, setBranch] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void repositoryPreviewAPI.refs(organization.id, repository).then(result => {
      if (!active) return;
      setRefs(result);
      setBranch(result.default_branch);
    }).catch(cause => { if (active) setError(translateError(cause, t, "repositories:browser.refsFailed")); });
    return () => { active = false; };
  }, [organization.id, repository, t]);
  if (!refs) return error ? <p role="alert" className="org-error">{error}</p> : <p role="status">{t("common:components.loading")}</p>;
  const branches = refs.items.filter(ref => ref.kind === "branch");
  const repo = repositoryPath(organizationHandle(organization), repository);
  if (section === "branches") return branches.length ? <ul className="repo-section-list">
    {branches.map(ref => <li key={ref.name}>
      <Link className="repo-link" to={`${repo}?${new URLSearchParams({ ref: `refs/heads/${ref.name}` })}`}><GitBranch size={16} aria-hidden="true"/>{ref.name}</Link>
      {ref.name === refs.default_branch && <span className="repo-section-badge">{t("sections.default")}</span>}
      <code>{ref.sha.slice(0, 7)}</code>
    </li>)}
  </ul> : <p>{t("sections.noBranches")}</p>;
  const save = async () => {
    if (busy || !branches.some(ref => ref.name === branch) || refs.default_branch === branch) return;
    setBusy(true);
    setError("");
    try {
      await repositoryAPI.updateDefaultBranch(organization.id, repository, branch, refs.default_branch);
      setRefs({ ...refs, default_branch: branch });
      setSaved(true);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:sections.settingsFailed"));
    } finally {
      setBusy(false);
    }
  };
  return <form className="repo-settings-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p>{t("sections.defaultBranchHelp")}</p>
    <Select label={t("sections.defaultBranch")} disabled={busy || !branches.length} value={branch}
      onChange={event => { setBranch(event.target.value); setSaved(false); }}
      options={branches.map(ref => ({ value: ref.name, label: ref.name }))}/>
    <Button type="submit" variant="primary" disabled={busy || branch === refs.default_branch || !branches.some(ref => ref.name === branch)}>{t("common:actions.save")}</Button>
    {saved && <p role="status">{t("sections.settingsSaved")}</p>}
    {error && <p role="alert" className="org-error">{error}</p>}
  </form>;
}

function RepositoryActions({ organization, repository, onNotify }: Props) {
  const { t } = useTranslation("repositories");
  const [search, setSearch] = useSearchParams();
  const offset = Number(search.get("offset")) || 0;
  const [result, setResult] = useState<Awaited<ReturnType<typeof repositoryAPI.actions>>>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setResult(undefined);
    setError("");
    void repositoryAPI.actions(organization.id, repository, offset)
      .then(data => { if (active) setResult(data); })
      .catch(cause => { if (active) setError(translateError(cause, t, "repositories:sections.actionsFailed")); });
    return () => { active = false; };
  }, [organization.id, repository, offset, t]);
  if (error) return <p className="org-error" role="alert">{error}</p>;
  if (!result) return <p role="status">{t("common:components.loading")}</p>;
  const handle = organizationHandle(organization);
  return <>
    {result.items.length ? <ul className="repo-section-list">
      {result.items.map(run => <li key={run.id}>
        <Link className="repo-link" to={pipelineRunPath(handle, run.id)}><Workflow size={16} aria-hidden="true"/>{run.pipeline} <small>v{run.version}</small></Link>
        <span className="repo-section-badge">{t(`pipelines:${run.status}`, { defaultValue: run.status })}</span>
        <time dateTime={run.created_at}>{formatDateTime(run.created_at)}</time>
      </li>)}
    </ul> : <p>{t("sections.noActions")}</p>}
    {(offset > 0 || result.has_more) && <div className="repo-section-pagination">
      <Button disabled={!offset} onClick={() => setSearch(offset > 20 ? { offset: String(offset - 20) } : {})}>{t("common:actions.previous")}</Button>
      <Button disabled={!result.has_more} onClick={() => setSearch({ offset: String(offset + 20) })}>{t("common:actions.next")}</Button>
    </div>}
  </>;
}
