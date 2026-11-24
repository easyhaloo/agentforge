import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { translateError } from "../../shared/api/errors";
import type { OrganizationSummary } from "../../shared/api/identity";
import { projectsAPI, type Project, type ProjectItem } from "../../shared/api/projects";
import { projectPath } from "../../shared/routing";
import { Button, Select } from "../../shared/ui";

type Props = { organization: OrganizationSummary; handle: string; repository: string; pullID: string };
type Association = { project: Project; item?: ProjectItem };

export function PullRequestProjects({ organization, handle, repository, pullID }: Props) {
  const { t } = useTranslation(["app", "navigation", "common", "errors"]);
  const { id: orgID } = organization;
  const editable = organization.role !== "viewer";
  const [associations, setAssociations] = useState<Association[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        const projects = await projectsAPI.list(orgID, undefined, signal);
        // The project API has no source filter. Check archived items only when no active item matches.
        const entries = await Promise.all(projects.map(async (project) => {
          const matches = (item: ProjectItem) => item.kind === "pull_request" && item.repository === repository && item.source_id === pullID;
          const active = await projectsAPI.items(orgID, project.number, false, signal);
          const item = active.find(matches) ?? (await projectsAPI.items(orgID, project.number, true, signal)).find(matches);
          return { project, item };
        }));
        if (!signal.aborted) setAssociations(entries);
      } catch {
        if (!signal.aborted) setLoadFailed(true);
      }
    })();
    return () => controller.abort();
  }, [orgID, pullID, refresh, repository]);

  const reload = () => {
    setAssociations(undefined);
    setLoadFailed(false);
    setSelected("");
    setError("");
    setRefresh(value => value + 1);
  };

  const available = associations?.filter(({ project, item }) => !project.closed && !item && (!project.repository || project.repository === repository)) ?? [];
  const linked = associations?.filter(({ item }) => Boolean(item)) ?? [];

  const changeAssociation = async (association: Association) => {
    const { project, item } = association;
    if (busy || !editable || project.closed) return;
    setBusy(true);
    setError("");
    try {
      let next: ProjectItem | undefined;
      if (item) await projectsAPI.removeItem(orgID, project.number, item.id, item.version);
      else next = await projectsAPI.addItem(orgID, project.number, { kind: "pull_request", repository, source_id: pullID });
      setAssociations(current => current?.map(entry => entry.project.number === project.number ? { project, item: next } : entry));
      setSelected("");
    } catch (cause) {
      setError(translateError(cause, t, "app:pullProjects.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const association = available.find(({ project }) => String(project.number) === selected);
    if (association) void changeAssociation(association);
  };

  const title = t("navigation:routes.projects");
  return <section className="pull-reviewers pull-projects" aria-label={title} aria-busy={busy || (!associations && !loadFailed)}>
    <h3>{title}</h3>
    {loadFailed ? <>
      <p role="alert">{t("app:pullProjects.loadFailed")}</p>
      <Button onClick={reload}>{t("app:organizationGate.retry")}</Button>
    </> : !associations ? <p role="status">{t("common:status.loading")}</p> : <>
      {linked.length === 0 ? <p>{t("app:pullProjects.none")}</p> : <ul>
        {linked.map(({ project, item }) => <li key={project.number}>
          <Link to={projectPath(handle, project.number)}>{project.name}</Link>
          {item?.archived && <span>{t("app:pullProjects.archived")}</span>}
          {editable && !project.closed && <Button size="small" disabled={busy} onClick={() => void changeAssociation({ project, item })}
            aria-label={t("app:pullProjects.removeNamed", { name: project.name })}>{t("app:pullProjects.remove")}</Button>}
        </li>)}
      </ul>}
      {editable && available.length > 0 && <form onSubmit={submit}>
        <Select aria-label={t("app:pullProjects.choose")} placeholder={t("app:pullProjects.choose")} value={selected} disabled={busy}
          onChange={event => setSelected(event.target.value)} options={available.map(({ project }) => ({ value: String(project.number), label: project.name }))} />
        <Button type="submit" size="small" disabled={busy || !selected}>{t("app:pullProjects.add")}</Button>
      </form>}
      {error && <>
        <p role="alert">{error}</p>
        <Button onClick={reload}>{t("app:pullProjects.refresh")}</Button>
      </>}
    </>}
  </section>;
}
