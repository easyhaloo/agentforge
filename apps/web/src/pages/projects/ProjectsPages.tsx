import { ArrowLeft, Columns3, Plus, Table2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { APIError, translateError } from "../../shared/api/errors";
import { repositoryAPI, type OrganizationSummary } from "../../shared/api/identity";
import { issuesAPI, type Issue, type IssuePage, type IssueProject, type ProjectLayout } from "../../shared/api/issues";
import { issueCreatePath, issueDetailPath, organizationHandle, orgPath, projectPath } from "../../shared/routing";
import { Button, DataTable, Input, Radio, Select } from "../../shared/ui";
import { canManageRepository } from "../repositories/repositoryPermissions";
import "./projects.css";

type ProjectProps = { organization: OrganizationSummary };

function useProjects(organizationID: string) {
  const [projects, setProjects] = useState<IssueProject[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    issuesAPI.projects(organizationID, "", controller.signal).then(setProjects, () => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [organizationID, attempt]);
  return { projects, failed, retry: () => { setFailed(false); setAttempt((value) => value + 1); } };
}

function ProjectLoadError({ retry }: { retry: () => void }) {
  const { t } = useTranslation("repositories");
  return <div className="projects-message">
    <p role="alert">{t("issues.projects.loadFailed")}</p>
    <Button onClick={retry}>{t("issues.composer.retry")}</Button>
  </div>;
}

function BackToProjects({ handle }: { handle: string }) {
  const { t } = useTranslation("repositories");
  return <Link className="projects-back" to={orgPath(handle, "projects")}>
    <ArrowLeft size={16} aria-hidden /> {t("projects.back")}
  </Link>;
}

export function ProjectsPage({ organization }: ProjectProps) {
  const { t, i18n } = useTranslation("repositories");
  const { projects, failed, retry } = useProjects(organization.id);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const handle = organizationHandle(organization);
  const search = query.trim().toLocaleLowerCase();
  const listed = projects?.filter((project) => project.name.toLocaleLowerCase().includes(search) ||
    (search !== "" && String(project.number) === search.replace(/^#/, "")))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, i18n.language) : b.number - a.number);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });

  return <section className="projects-page">
    <header className="projects-heading">
      <div><h1>{t("projects.title")}</h1><p>{t("projects.subtitle", { organization: organization.name })}</p></div>
      {canManageRepository(organization) && <Link className="af-button af-button--primary af-button--middle" to={projectPath(handle, "new")}>
        <Plus size={16} aria-hidden /> {t("projects.new")}
      </Link>}
    </header>
    {failed ? <ProjectLoadError retry={retry} /> : !listed ? <p role="status">{t("common:components.loading")}</p> : <>
      <div className="projects-toolbar">
        <Input type="search" aria-label={t("projects.search")} placeholder={t("projects.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
        <Select aria-label={t("projects.sort")} value={sort} onChange={(event) => setSort(event.target.value)} options={[
          { value: "newest", label: t("projects.newest") }, { value: "name", label: t("issues.projects.name") },
        ]} />
      </div>
      {listed.length === 0 ? <p className="projects-message">{t(search ? "projects.noResults" : "issues.projects.empty")}</p> :
        <ul className="projects-directory">
          {listed.map((project) => <li key={project.id}>
            <span className="projects-glyph">{project.layout === "board" ? <Columns3 size={18} aria-hidden /> : <Table2 size={18} aria-hidden />}</span>
            <div className="projects-row-title"><Link to={projectPath(handle, project.number)}>{project.name}</Link> <span>#{project.number}</span></div>
            <span>{project.repository || project.default_repository || t("issues.projects.organizationWide")}</span>
            <span>{project.created_at && <time dateTime={project.created_at}>{date.format(new Date(project.created_at))}</time>}</span>
          </li>)}
        </ul>}
    </>}
  </section>;
}

export function ProjectCreatePage({ organization }: ProjectProps) {
  const { t } = useTranslation("repositories");
  const navigate = useNavigate();
  const handle = organizationHandle(organization);
  const [name, setName] = useState("");
  const [layout, setLayout] = useState<ProjectLayout>("table");
  const [repository, setRepository] = useState("");
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
      const project = await issuesAPI.createProject(organization.id, {
        name: name.trim(), layout, ...(repository && { default_repository: repository }),
      });
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
    <BackToProjects handle={handle} />
    <header className="projects-heading">
      <div><h1 ref={headingRef} tabIndex={-1}>{t("projects.new")}</h1><p>{t("projects.subtitle", { organization: organization.name })}</p></div>
    </header>
    {!allowed ? <p role="alert">{t("projects.noPermission")}</p> : <form onSubmit={(event) => void create(event)} noValidate>
      {error && <p className="projects-error" role="alert" tabIndex={-1} ref={(node) => { node?.focus(); }}>{error}</p>}
      <div className="projects-create-grid">
        <fieldset className="projects-layout-options" disabled={saving}>
          <legend>{t("projects.start")}</legend>
          <label><Radio name="layout" value="table" checked={layout === "table"} onChange={() => setLayout("table")} />
            <Table2 size={18} aria-hidden /> {t("projects.table")}</label>
          <label><Radio name="layout" value="board" checked={layout === "board"} onChange={() => setLayout("board")} />
            <Columns3 size={18} aria-hidden /> {t("projects.board")}</label>
        </fieldset>
        <div className="projects-config">
          <Input ref={nameRef} label={t("issues.projects.name")} aria-label={t("issues.projects.name")} value={name} onChange={(event) => { setName(event.target.value); setNameError(""); }}
            required maxLength={100} readOnly={saving} error={nameError ? <span role="alert">{nameError}</span> : undefined} />
          <dl className="projects-owner"><dt>{t("projects.owner")}</dt><dd>{organization.name}</dd></dl>
          <Select label={t("projects.defaultRepository")} value={repository} onChange={(event) => setRepository(event.target.value)}
            disabled={saving || !repositories?.length} options={[
              { value: "", label: t("projects.noDefault") }, ...(repositories ?? []).map((slug) => ({ value: slug, label: slug })),
            ]} />
          {repositoryError && <div><p role="status">{t("projects.repositoryLoadFailed")}</p><Button onClick={() => {
            setRepositoryError(false); setRepositoryAttempt((value) => value + 1);
          }}>{t("issues.composer.retry")}</Button></div>}
          <div className="projects-actions">
            <Button type="submit" variant="primary" loading={saving}>{t("projects.create")}</Button>
            <Link className="af-button af-button--secondary af-button--middle" to={orgPath(handle, "projects")}>{t("projects.cancel")}</Link>
          </div>
        </div>
      </div>
    </form>}
  </section>;
}

export function ProjectDetailPage({ organization, number }: ProjectProps & { number: string }) {
  const { t } = useTranslation("repositories");
  const { projects, failed, retry } = useProjects(organization.id);
  const handle = organizationHandle(organization);
  const project = projects?.find((item) => String(item.number) === number);
  return <section className="projects-page">
    <BackToProjects handle={handle} />
    {failed ? <ProjectLoadError retry={retry} /> : !projects ? <p role="status">{t("common:components.loading")}</p> : !project ?
      <h1>{t("projects.notFound")}</h1> : <ProjectIssues organization={organization} project={project} />}
  </section>;
}

const issuesPerPage = 30;
function ProjectIssues({ organization, project }: ProjectProps & { project: IssueProject }) {
  const { t } = useTranslation("repositories");
  const handle = organizationHandle(organization);
  const [layout, setLayout] = useState<ProjectLayout>(project.layout ?? "table");
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<IssuePage>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    issuesAPI.list(organization.id, { project_id: project.id, limit: issuesPerPage, offset }, controller.signal).then((page) => {
      if (!controller.signal.aborted) setResult(page);
    }, () => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [organization.id, project.id, offset, attempt]);
  const defaultRepo = project.default_repository || project.repository;
  const issueLink = (issue: Issue) => <Link to={issueDetailPath(handle, issue.repository, issue.number)}>{issue.title}</Link>;

  function changePage(nextOffset: number) {
    setResult(undefined);
    setOffset(nextOffset);
  }

  return <>
    <header className="projects-heading">
      <h1>{project.name} <span className="projects-number">#{project.number}</span></h1>
      {defaultRepo && canManageRepository(organization) && <Link className="af-button af-button--secondary af-button--middle"
        to={`${issueCreatePath(handle, defaultRepo)}?${new URLSearchParams({ projects: `${handle}/${project.number}` })}`}>
        <Plus size={16} aria-hidden /> {t("projects.newIssue")}
      </Link>}
    </header>
    <div className="projects-toolbar" role="group" aria-label={t("projects.view")}>
      <Button variant={layout === "table" ? "secondary" : "ghost"} aria-pressed={layout === "table"} onClick={() => setLayout("table")}><Table2 size={16} aria-hidden /> {t("projects.table")}</Button>
      <Button variant={layout === "board" ? "secondary" : "ghost"} aria-pressed={layout === "board"} onClick={() => setLayout("board")}><Columns3 size={16} aria-hidden /> {t("projects.board")}</Button>
    </div>
    {failed ? <ProjectLoadError retry={() => { setFailed(false); setAttempt((value) => value + 1); }} /> : !result ?
      <p role="status">{t("common:components.loading")}</p> : <>
        {layout === "board" ? <>
          {!result.items.length && <p className="projects-message">{t("projects.noIssues")}</p>}
          <div className="projects-board">
            {(["open", "closed"] as const).map((state) => <section key={state}>
              <h2>{t(state === "open" ? "projects.open" : "projects.closed")} <span>{state === "open" ? result.open_total : result.closed_total}</span></h2>
              <ul>{result.items.filter((issue) => issue.state === state).map((issue) => <li key={issue.id}>
                <span>{issue.repository}#{issue.number}</span>{issueLink(issue)}
              </li>)}</ul>
            </section>)}
          </div>
        </> : <DataTable<Issue> data={result.items} rowKey="id" showColumnVisibility={false} emptyText={t("projects.noIssues")} columns={[
          { key: "title", title: t("projects.issueTitle"), render: (_, issue) => issueLink(issue) },
          { key: "repository", title: t("projects.repository"), render: (_, issue) => `${issue.repository}#${issue.number}` },
          { key: "state", title: t("projects.issueState"), render: (_, issue) => t(issue.state === "open" ? "projects.open" : "projects.closed") },
        ]} />}
        {(offset > 0 || result.total > issuesPerPage) && <div className="projects-toolbar">
          <Button disabled={offset === 0} onClick={() => changePage(offset - issuesPerPage)}>{t("projects.previous")}</Button>
          <Button disabled={offset + issuesPerPage >= result.total} onClick={() => changePage(offset + issuesPerPage)}>{t("projects.next")}</Button>
        </div>}
      </>}
  </>;
}
