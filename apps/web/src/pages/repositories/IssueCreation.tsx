import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { issueCreatePath, issueTemplatePath, organizationHandle, repositoryPath } from "../../shared/routing";
import { Button } from "../../shared/ui";
import { IssueCreatePage, type IssueCreatePageProps } from "./IssueCreatePage";
import { loadIssueTemplates, type IssueTemplates } from "./issueTemplates";

type State = { status: "loading" } | { status: "failed" } | { status: "ready"; data: IssueTemplates };

export function IssueCreation({ chooseTemplate, ...props }: IssueCreatePageProps & { chooseTemplate: boolean }) {
  const { t } = useTranslation("repositories");
  const [query] = useSearchParams();
  if (props.organization.role === "viewer") {
    const issuesPath = repositoryPath(organizationHandle(props.organization), `${props.owner}/${props.repo}`, "issues");
    return <section className="issue-create">
      <h1>{t("issues.newIssue")}</h1>
      <p role="alert">{t("issues.createDenied")}</p>
      <Link to={issuesPath}>{t("issues.detail.backToList")}</Link>
    </section>;
  }
  const requested = query.get("template");
  if (!chooseTemplate && requested === null) return <IssueCreatePage {...props} />;
  return <IssueTemplateSelection requested={requested} {...props} />;
}

function IssueTemplateSelection({ requested, ...props }: IssueCreatePageProps & { requested: string | null }) {
  const { t } = useTranslation("repositories");
  const { organization, owner, repo } = props;
  const repository = `${owner}/${repo}`;
  const handle = organizationHandle(organization);
  const editor = issueCreatePath(handle, repository);
  const chooser = issueTemplatePath(handle, repository);
  const [query] = useSearchParams();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadIssueTemplates(organization.id, repository).then((data) => {
      if (active) setState({ status: "ready", data });
    }, () => {
      if (active) setState({ status: "failed" });
    });
    return () => { active = false; };
  }, [organization.id, repository, attempt]);

  if (state.status === "loading") return <section className="issue-create">
    <h1>{t("issues.newIssue")}</h1>
    <p role="status">{t("common:components.loading")}</p>
  </section>;
  if (state.status === "failed") return <section className="issue-create">
    <h1>{t("issues.newIssue")}</h1>
    <p role="alert">{t("issues.templates.loadFailed")}</p>
    <Button type="button" variant="secondary" onClick={() => {
      setState({ status: "loading" });
      setAttempt((value) => value + 1);
    }}>{t("issues.composer.retry")}</Button>
    <p><Link to={repositoryPath(handle, repository, "issues")}>{t("common:actions.cancel")}</Link></p>
  </section>;

  const { templates, contacts, blankEnabled, invalid } = state.data;
  const selected = templates.find((entry) => entry.filename === requested);
  if (requested !== null) return selected ? <IssueCreatePage key={selected.filename} {...props} template={selected} /> : <section className="issue-create">
    <h1>{t("issues.newIssue")}</h1>
    <p role="alert">{t("issues.templates.notFound", { filename: requested })}</p>
    <Link to={chooser}>{t("issues.templates.choose")}</Link>
  </section>;
  if (!templates.length && !contacts.length && !invalid && blankEnabled) return <Navigate to={`${editor}${query.size ? `?${query}` : ""}`} replace />;

  return <section className="issue-create" aria-labelledby="issue-template-heading">
    <h1 id="issue-template-heading">{t("issues.templates.choose")}</h1>
    {invalid && <p role="status">{t("issues.templates.invalid")}</p>}
    <ul className="issue-template-list">
      {templates.map((entry) => {
        const parameters = new URLSearchParams(query);
        parameters.set("template", entry.filename);
        return <li key={entry.filename}>
          <Link to={`${editor}?${parameters}`}>{entry.name || t("issues.templates.legacyName")}</Link>
          {entry.description && <p>{entry.description}</p>}
        </li>;
      })}
      {contacts.map(({ name, description, url }) => <li key={`${name}:${url}`}>
        <a href={url} target="_blank" rel="noreferrer">{name}</a>
        <p>{description}</p>
      </li>)}
      <li>
        <Link to={`${editor}${query.size ? `?${query}` : ""}`}>{t("issues.templates.blank")}</Link>
        {!blankEnabled && <p>{t("issues.templates.maintainersOnly")}</p>}
      </li>
    </ul>
    <Link to={repositoryPath(handle, repository, "issues")}>{t("common:actions.cancel")}</Link>
  </section>;
}
