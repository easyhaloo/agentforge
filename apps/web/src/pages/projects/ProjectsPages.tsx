import { ArrowLeft, CalendarRange, Columns3, Plus, Table2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { APIError, translateError } from "../../shared/api/errors";
import { repositoryAPI, type OrganizationSummary } from "../../shared/api/identity";
import type { ProjectLayout } from "../../shared/api/issues";
import { projectLayouts, projectsAPI, type Project, type ProjectTemplate } from "../../shared/api/projects";
import { organizationHandle, orgPath, projectPath, repositoryPath } from "../../shared/routing";
import { Button, Checkbox, Input, Radio, Select } from "../../shared/ui";
import { canManageRepository } from "../repositories/repositoryPermissions";
import "./projects.css";

type ProjectProps = { organization: OrganizationSummary };

function useProjects(organizationID: string, repository?: string) {
  const [projects, setProjects] = useState<Project[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    projectsAPI.list(organizationID, repository, controller.signal).then((items) => {
      if (!controller.signal.aborted) setProjects(items);
    }, () => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [organizationID, repository, attempt]);
  return { projects, failed, retry: () => { setFailed(false); setAttempt((value) => value + 1); } };
}

function ProjectLoadError({ retry }: { retry: () => void }) {
  const { t } = useTranslation("repositories");
  return <div className="projects-message">
    <p role="alert">{t("issues.projects.loadFailed")}</p>
    <Button onClick={retry}>{t("issues.composer.retry")}</Button>
  </div>;
}

function BackToProjects({ handle, repository }: { handle: string; repository?: string }) {
  const { t } = useTranslation("repositories");
  return <Link className="projects-back" to={repository ? repositoryPath(handle, repository, "projects") : orgPath(handle, "projects")}>
    <ArrowLeft size={16} aria-hidden /> {t("projects.back")}
  </Link>;
}

export function ProjectsPage({ organization, repository }: ProjectProps & { repository?: string }) {
  const { t, i18n } = useTranslation("repositories");
  const { projects, failed, retry } = useProjects(organization.id, repository);
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState(false);
  const [sort, setSort] = useState("newest");
  const handle = organizationHandle(organization);
  const search = query.trim().toLocaleLowerCase();
  const listed = projects?.filter((project) => Boolean(project.closed) === closed && (project.name.toLocaleLowerCase().includes(search) ||
    (search !== "" && String(project.number) === search.replace(/^#/, ""))))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, i18n.language) : (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.number - a.number);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });

  return <section className="projects-page">
    <header className="projects-heading">
      <div><h1>{t("projects.title")}</h1><p>{t("projects.subtitle", { organization: organization.name })}</p></div>
      {canManageRepository(organization) && <Link className="af-button af-button--primary af-button--middle" to={`${projectPath(handle, "new")}${repository ? `?${new URLSearchParams({ repository, return: "repository" })}` : ""}`}>
        <Plus size={16} aria-hidden /> {t("projects.new")}
      </Link>}
    </header>
    {failed ? <ProjectLoadError retry={retry} /> : !listed ? <p role="status">{t("common:components.loading")}</p> : <>
      <div className="projects-toolbar">
        <div className="projects-toolbar" role="group" aria-label={t("projects.state")} >
          <Button aria-pressed={!closed} onClick={() => setClosed(false)}>{t("projects.open")}</Button>
          <Button aria-pressed={closed} onClick={() => setClosed(true)}>{t("projects.closed")}</Button>
        </div>
        <Input type="search" aria-label={t("projects.search")} placeholder={t("projects.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
        <Select aria-label={t("projects.sort")} value={sort} onChange={(event) => setSort(event.target.value)} options={[
          { value: "newest", label: t("projects.newest") }, { value: "name", label: t("issues.projects.name") },
        ]} />
      </div>
      {listed.length === 0 ? <p className="projects-message">{t(search ? "projects.noResults" : "issues.projects.empty")}</p> :
        <ul className="projects-directory">
          {listed.map((project) => <li key={project.id}>
            <span className="projects-glyph">{<ProjectLayoutIcon layout={project.views?.[0]?.layout ?? project.layout ?? "table"} />}</span>
            <div className="projects-row-title"><Link to={projectPath(handle, project.number)}>{project.name}</Link> <span>#{project.number}</span>{project.description && <p>{project.description}</p>}</div>
            <span>{project.repositories?.join(", ") || project.repository || project.default_repository || t("issues.projects.organizationWide")}</span>
            <span>{(project.updated_at ?? project.created_at) && <time dateTime={project.updated_at ?? project.created_at}>{date.format(new Date(project.updated_at ?? project.created_at!))}</time>}</span>
          </li>)}
        </ul>}
    </>}
  </section>;
}

function ProjectLayoutIcon({ layout }: { layout: ProjectLayout }) {
  const Icon = layout === "board" ? Columns3 : layout === "roadmap" ? CalendarRange : Table2;
  return <Icon size={18} aria-hidden />;
}

const templates = { team_backlog: "board", release_plan: "roadmap" } as const;

export function ProjectCreatePage({ organization }: ProjectProps) {
  const { t } = useTranslation("repositories");
  const navigate = useNavigate();
  const handle = organizationHandle(organization);
  const [params] = useSearchParams();
  const source = params.get("repository") ?? "";
  const returnRepository = params.get("return") === "repository" && /^[^/]+\/[^/]+$/.test(source) ? source : undefined;
  const [name, setName] = useState("");
  const [start, setStart] = useState<ProjectLayout | ProjectTemplate>("table");
  const [repository, setRepository] = useState(source);
  const [importIssues, setImportIssues] = useState(false);
  const [repositories, setRepositories] = useState<string[]>();
  const [repositoryError, setRepositoryError] = useState(false);
  const [repositoryAttempt, setRepositoryAttempt] = useState(0);
  const [nameError, setNameError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitInFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const allowed = canManageRepository(organization);

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    repositoryAPI.list(organization.id, controller.signal).then(({ items }) => {
      if (!controller.signal.aborted) setRepositories((items ?? []).map(({ slug }) => slug));
    }, () => {
      if (!controller.signal.aborted) setRepositoryError(true);
    });
    return () => controller.abort();
  }, [organization.id, allowed, repositoryAttempt]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowed || submitInFlight.current) return;
    setError("");
    setNameError("");
    if (!name.trim()) {
      setNameError(t("issues.projects.nameRequired"));
      nameRef.current?.focus();
      return;
    }
    submitInFlight.current = true;
    setSaving(true);
    try {
      const template = start === "team_backlog" || start === "release_plan" ? start : undefined;
      const selectedRepository = repositories?.includes(repository) ? repository : "";
      const project = await projectsAPI.create(organization.id, {
        name: name.trim(), layout: start === "team_backlog" || start === "release_plan" ? templates[start] : start,
        ...(template && { template }),
        ...(selectedRepository && { default_repository: selectedRepository }),
        ...(returnRepository && repositories?.includes(returnRepository) && { repositories: [returnRepository] }),
      });
      if (importIssues && selectedRepository) {
        void navigate(`${projectPath(handle, project.number)}?${new URLSearchParams({ page: "add", repository: selectedRepository })}`, { replace: true });
        return;
      }
      void navigate(projectPath(handle, project.number), { replace: true });
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 409) {
        setNameError(t("issues.projects.duplicate"));
      } else {
        setError(translateError(cause, t, "issues.createFailed"));
      }
    } finally {
      submitInFlight.current = false;
      setSaving(false);
    }
  }

  useEffect(() => { if (nameError && !saving) nameRef.current?.focus(); }, [nameError, saving]);

  return <section className="projects-page projects-create-page">
    <BackToProjects handle={handle} repository={returnRepository} />
    <header className="projects-heading">
      <div><h1 ref={headingRef} tabIndex={-1}>{t("projects.new")}</h1><p>{t("projects.subtitle", { organization: organization.name })}</p></div>
    </header>
    {!allowed ? <p role="alert">{t("projects.noPermission")}</p> : <form onSubmit={(event) => void create(event)} noValidate>
      {error && <p className="projects-error" role="alert" tabIndex={-1} ref={(node) => { node?.focus(); }}>{error}</p>}
      <div className="projects-create-grid">
        <fieldset className="projects-layout-options" disabled={saving}>
          <legend>{t("projects.start")}</legend>
          {projectLayouts.map((layout) => <label key={layout}><Radio name="layout" value={layout} checked={start === layout} onChange={() => setStart(layout)} />
            <ProjectLayoutIcon layout={layout} /> {t(`projects.${layout}`)}</label>)}
          <h2>{t("projects.templates")}</h2>
          {(Object.keys(templates) as ProjectTemplate[]).map((template) => <label key={template}>
            <Radio name="layout" value={template} checked={start === template} onChange={() => setStart(template)} />
            <ProjectLayoutIcon layout={templates[template]} /> {t(`projects.${template}`)}
          </label>)}
        </fieldset>
        <div className="projects-config">
          <Input ref={nameRef} label={t("issues.projects.name")} aria-label={t("issues.projects.name")} value={name} onChange={(event) => { setName(event.target.value); setNameError(""); }}
            required maxLength={100} readOnly={saving} error={nameError ? <span role="alert">{nameError}</span> : undefined} />
          <dl className="projects-owner"><dt>{t("projects.owner")}</dt><dd>{organization.name}</dd></dl>
          <Select label={t("projects.defaultRepository")} value={repository} onChange={(event) => setRepository(event.target.value)}
            disabled={saving || !repositories?.length} options={[
              { value: "", label: t("projects.noDefault") }, ...(repositories ?? []).map((slug) => ({ value: slug, label: slug })),
            ]} />
          {repositories?.includes(repository) && <Checkbox label={t("projects.chooseImport")} checked={importIssues} disabled={saving}
            onChange={(event) => setImportIssues(event.target.checked)} />}
          {repositoryError && <div><p role="status">{t("projects.repositoryLoadFailed")}</p><Button onClick={() => {
            setRepositoryError(false); setRepositoryAttempt((value) => value + 1);
          }}>{t("issues.composer.retry")}</Button></div>}
          <div className="projects-actions">
            <Button type="submit" variant="primary" loading={saving}>{t("projects.create")}</Button>
            <Link className="af-button af-button--secondary af-button--middle" to={returnRepository ? repositoryPath(handle, returnRepository, "projects") : orgPath(handle, "projects")}>{t("projects.cancel")}</Link>
          </div>
        </div>
      </div>
    </form>}
  </section>;
}

export { ProjectDetailPage } from "./ProjectWorkspace";
