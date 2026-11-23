import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { APIError, translateError } from "../../shared/api/errors";
import { repositoryAPI, type OrganizationSummary } from "../../shared/api/identity";
import { issuesAPI, type IssueProject } from "../../shared/api/issues";
import { Button, Input, Select } from "../../shared/ui";
import { canManageRepository } from "./repositoryPermissions";
import "./repositories.css";

export function IssueProjectsPanel({ organization }: { organization: OrganizationSummary }) {
  const { t } = useTranslation("repositories");
  const [items, setItems] = useState<IssueProject[]>();
  const [repositories, setRepositories] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [repository, setRepository] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const canCreate = canManageRepository(organization);

  useEffect(() => {
    const controller = new AbortController();
    const availableRepositories = canCreate ? repositoryAPI.list(organization.id) : Promise.resolve({ items: [] });
    Promise.all([issuesAPI.projects(organization.id, "", controller.signal), availableRepositories]).then(([projects, available]) => {
      if (controller.signal.aborted) return;
      setItems(projects);
      setRepositories((available.items ?? []).map(({ slug }) => slug));
    }).catch(() => {
      if (!controller.signal.aborted) setError("issues.projects.loadFailed");
    });
    return () => controller.abort();
  }, [organization.id, canCreate, attempt]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!name.trim()) {
      setFormError(t("issues.projects.nameRequired"));
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const project = await issuesAPI.createProject(organization.id, name.trim(), repository);
      setItems((current) => [...(current ?? []), project].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
    } catch (cause) {
      setFormError(cause instanceof APIError && cause.status === 409
        ? t("issues.projects.duplicate") : translateError(cause, t, "issues.createFailed"));
    } finally {
      setSaving(false);
    }
  }

  return <section className="card repo-section-content issue-projects-panel" aria-label={t("issues.projects.manage")}>
    <h2>{t("issues.projects.manage")}</h2>
    {error ? <>
      <p role="alert">{t(error)}</p>
      <Button onClick={() => { setError(""); setAttempt(attempt + 1); }}>{t("issues.composer.retry")}</Button>
    </> : !items ? <p role="status">{t("common:components.loading")}</p> : <>
      {items.length === 0 ? <p>{t("issues.projects.empty")}</p> : <ul className="repo-section-list">
        {items.map((project) => <li key={project.id}>
          <strong>{project.name}</strong>
          <span>{project.repository || t("issues.projects.organizationWide")}</span>
        </li>)}
      </ul>}
      {canCreate && <form className="repo-toolbar" onSubmit={(event) => void create(event)}>
        <Input label={t("issues.projects.name")} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={saving} />
        <Select label={t("issues.projects.scope")} value={repository} onChange={(event) => setRepository(event.target.value)} disabled={saving}
          options={[{ value: "", label: t("issues.projects.organizationWide") }, ...repositories.map((slug) => ({ value: slug, label: slug }))]} />
        <Button type="submit" disabled={saving}>{t("issues.projects.create")}</Button>
        {formError && <p role="alert">{formError}</p>}
      </form>}
    </>}
  </section>;
}
