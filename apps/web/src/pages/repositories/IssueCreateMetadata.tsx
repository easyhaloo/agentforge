import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { issuesAPI, issueTypes, type IssueProject, type IssueType } from "../../shared/api/issues";
import { organizationAPI, type OrganizationMember } from "../../shared/api/identity";
import { Button, Checkbox, RadioGroup } from "../../shared/ui";

export interface IssueMetadata {
  assignees: string[];
  label_ids: string[];
  milestone_id: string;
  issue_type: IssueType | "";
  project_ids: string[];
}

type Option = { id: string; name: string };
type Options = Record<Exclude<keyof IssueMetadata, "issue_type" | "project_ids">, Option[]>;

async function activeMembers(organizationID: string) {
  const members: OrganizationMember[] = [];
  let offset = 0;
  for (;;) {
    const page = await organizationAPI.members(organizationID, offset);
    members.push(...page.items.filter((member) => member.status === "active"));
    if (page.items.length < page.limit) return members;
    offset += page.limit;
  }
}

async function loadOptions(organizationID: string, owner: string, repo: string): Promise<Options> {
  const [members, labels, milestones] = await Promise.all([
    activeMembers(organizationID),
    issuesAPI.labels(organizationID, owner, repo),
    issuesAPI.milestones(organizationID, owner, repo),
  ]);
  return {
    assignees: members.map(({ user_id, display_name }) => ({ id: user_id, name: display_name || user_id })),
    label_ids: labels,
    milestone_id: milestones,
  };
}

export async function prefillIssueMetadata(organizationID: string, handle: string, owner: string, repo: string, params: URLSearchParams): Promise<IssueMetadata | undefined> {
  const references = (params.get("projects") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const [options, projects] = await Promise.all([
    loadOptions(organizationID, owner, repo),
    references.length ? issuesAPI.projects(organizationID, `${owner}/${repo}`) : [],
  ]);
  function resolve(value: string, choices: Option[]) {
    const exact = choices.find(({ id }) => id === value);
    if (exact) return exact.id;
    const matches = choices.filter(({ name }) => name.toLowerCase() === value.toLowerCase());
    return matches.length === 1 ? matches[0].id : undefined;
  }

  const assignees = (params.get("assignees") ?? "").split(",").map((value) => value.trim()).filter(Boolean)
    .map((value) => resolve(value, options.assignees));
  const labelIDs = (params.get("labels") ?? "").split(",").map((value) => value.trim()).filter(Boolean)
    .map((value) => resolve(value, options.label_ids));
  const milestone = params.get("milestone")?.trim();
  const milestoneID = milestone ? resolve(milestone, options.milestone_id) : "";
  const projectIDs = references.map((value) => projects.find(({ id, number }) =>
    id === value || [handle, organizationID].some((org) => `${org.toLowerCase()}/${number}` === value.toLowerCase()),
  )?.id);
  if (assignees.includes(undefined) || labelIDs.includes(undefined) || projectIDs.includes(undefined) || milestoneID === undefined) return;
  return {
    assignees: [...new Set(assignees.filter((id) => id !== undefined))],
    label_ids: [...new Set(labelIDs.filter((id) => id !== undefined))],
    milestone_id: milestoneID,
    project_ids: [...new Set(projectIDs.filter((id) => id !== undefined))],
    issue_type: issueTypes.find((type) => type === params.get("type")?.trim().toLowerCase()) ?? "",
  };
}

export function IssueCreateMetadata({ organizationID, owner, repo, value, onChange, field }: {
  organizationID: string;
  owner: string;
  repo: string;
  value: IssueMetadata;
  onChange: (next: IssueMetadata) => void;
  field?: keyof IssueMetadata;
}) {
  const { t } = useTranslation("repositories");
  const [options, setOptions] = useState<Options>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [projects, setProjects] = useState<IssueProject[] | null>();
  const [projectAttempt, setProjectAttempt] = useState(0);

  useEffect(() => {
    if (field && field !== "project_ids") return;
    const controller = new AbortController();
    issuesAPI.projects(organizationID, `${owner}/${repo}`, controller.signal).then((items) => {
      if (!controller.signal.aborted) setProjects(items);
    }).catch(() => {
      if (!controller.signal.aborted) setProjects(null);
    });
    return () => controller.abort();
  }, [organizationID, owner, repo, projectAttempt, field]);

  useEffect(() => {
    if (field === "project_ids" || field === "issue_type") return;
    let current = true;
    loadOptions(organizationID, owner, repo).then((result) => {
      if (current) setOptions(result);
    }).catch(() => {
      if (current) setFailed(true);
    });
    return () => { current = false; };
  }, [organizationID, owner, repo, attempt, field]);

  function choices(key: keyof Options): Option[] {
    const available = options?.[key] ?? [];
    const selected = value[key];
    const ids = typeof selected === "string" ? (selected ? [selected] : []) : selected;
    return available.concat(ids.filter((id) => !available.some((option) => option.id === id)).map((id) => ({ id, name: t("issues.composer.unavailableOption", { id }) })));
  }

  if (failed) return <div className="issue-metadata-options">
    <p role="alert">{t("issues.composer.metadataFailed")}</p>
    <Button type="button" variant="secondary" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>
      {t("issues.composer.retry")}
    </Button>
  </div>;
  if (!options && field !== "project_ids" && field !== "issue_type") return <p role="status">{t("common:components.loading")}</p>;

  return <div className="issue-metadata-options">
    {(!field || field === "issue_type") && <RadioGroup label={t("issues.type.label")} name="issue-new-type" value={value.issue_type}
      options={[{ value: "", label: t("issues.type.none") }, ...issueTypes.map((type) => ({ value: type, label: t(`issues.type.${type}`) }))]}
      onChange={(selected) => onChange({ ...value, issue_type: issueTypes.find((type) => type === selected) ?? "" })} />}
    {([["assignees", "assignees", "noAssignees"], ["label_ids", "labels", "noLabels"]] as const).filter(([key]) => !field || field === key).map(([key, label, empty]) => {
      const items = choices(key);
      return <fieldset key={key}>
        <legend>{t(`issues.${label}`)}</legend>
        {items.length === 0 && <p>{t(`issues.${empty}`)}</p>}
        {items.map(({ id, name }) => <Checkbox key={id} label={name} checked={value[key].includes(id)}
          onChange={(event) => onChange({ ...value, [key]: event.target.checked
            ? [...value[key], id] : value[key].filter((current) => current !== id) })} />)}
      </fieldset>;
    })}
    {(!field || field === "milestone_id") && <RadioGroup label={t("issues.milestone")} name="issue-new-milestone" value={value.milestone_id}
      options={[{ value: "", label: t("issues.noMilestone") }, ...choices("milestone_id").map(({ id, name }) => ({ value: id, label: name }))]}
      onChange={(milestone_id) => onChange({ ...value, milestone_id })} />}
    {(!field || field === "project_ids") && <fieldset>
      <legend>{t("issues.projects.title")}</legend>
      {projects === undefined && <p role="status">{t("common:components.loading")}</p>}
      {projects === null && <>
        <p role="alert">{t("issues.projects.loadFailed")}</p>
        <Button type="button" variant="secondary" onClick={() => { setProjects(undefined); setProjectAttempt(projectAttempt + 1); }}>
          {t("issues.composer.retry")}
        </Button>
      </>}
      {projects?.length === 0 && <p>{t("issues.projects.empty")}</p>}
      {projects && ([
        ["recent", projects.filter((project) => project.recent)],
        ["repository", projects.filter((project) => !project.recent && project.repository)],
        ["organization", projects.filter((project) => !project.recent && !project.repository)],
      ] as const).filter(([, items]) => items.length > 0).map(([group, items]) => <fieldset key={group}>
        <legend>{t(`issues.projects.${group}`)}</legend>
        {items.map(({ id, name }) => <Checkbox key={id} label={name} checked={value.project_ids.includes(id)}
          onChange={(event) => onChange({ ...value, project_ids: event.target.checked
            ? [...value.project_ids, id] : value.project_ids.filter((current) => current !== id) })} />)}
      </fieldset>)}
    </fieldset>}
  </div>;
}
