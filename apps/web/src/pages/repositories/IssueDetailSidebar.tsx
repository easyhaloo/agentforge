import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { changesetAPI } from "../../shared/api/identity";
import type { Issue, IssueUpdate } from "../../shared/api/issues";
import { changesetPath, pullRequestComparePath } from "../../shared/routing";
import { Button, Checkbox, Input, Modal } from "../../shared/ui";
import { IssueBranches } from "./IssueBranches";

type SidebarProps = {
  issue: Issue;
  editable: boolean;
  busy: boolean;
  error: string;
  resetError: () => void;
  save: (update: IssueUpdate, close: () => void) => Promise<void>;
};

export function IssueDetailFields({ issue, editable, busy, error, resetError, save }: SidebarProps) {
  const { t } = useTranslation("repositories");
  const [draft, setDraft] = useState<{ rows: [string, string][]; version: string }>();
  const entries = Object.entries(issue.custom_fields ?? {});
  const label = t("issues.detail.fields");
  const names = draft?.rows.map(([name]) => name.trim()) ?? [];
  const invalid = names.some((name) => !name) || new Set(names).size !== names.length;
  const change = (index: number, column: 0 | 1, input: string) => setDraft((current) => current && ({
    ...current,
    rows: current.rows.map(([name, value], i) => i !== index ? [name, value] : column === 0 ? [input, value] : [name, input]),
  }));
  return <div className="issue-sidebar-section">
    <div className="issue-sidebar-heading">
      <h3>{label}</h3>
      {editable && <Button variant="ghost" size="small" disabled={busy} aria-label={t("issues.detail.editMetadata", { field: label })}
        onClick={() => { resetError(); setDraft({ rows: entries.length ? entries : [["", ""]], version: issue.updated_at }); }}>
        <Settings size={15} aria-hidden="true" />
      </Button>}
    </div>
    {entries.length ? <dl className="issue-metadata">{entries.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
      : <p className="issue-sidebar-empty">{t("issues.detail.noFields")}</p>}
    {draft && <Modal open title={label} okText={t("common:actions.save")} okDisabled={invalid} confirmLoading={busy}
      onCancel={() => setDraft(undefined)} onOk={() => save({
        custom_fields: Object.fromEntries(draft.rows.map(([name, value]) => [name.trim(), value])), expected_updated_at: draft.version,
      }, () => setDraft(undefined))}>
      {error && <p role="alert">{error}</p>}
      <div className="issue-detail__sidebar-editor">
        {draft.rows.map(([name, value], index) => <fieldset key={index} disabled={busy}>
          <Input label={t("issues.detail.fieldName")} value={name} maxLength={64} onChange={(event) => change(index, 0, event.target.value)} />
          <Input label={t("issues.detail.fieldValue")} value={value} maxLength={500} onChange={(event) => change(index, 1, event.target.value)} />
          <Button variant="ghost" size="small" onClick={() => setDraft({ ...draft, rows: draft.rows.filter((_, i) => i !== index) })}>{t("issues.detail.removeField")}</Button>
        </fieldset>)}
        {new Set(names).size !== names.length && <p role="alert">{t("issues.detail.uniqueFields")}</p>}
        <Button variant="secondary" size="small" disabled={busy || draft.rows.length >= 20}
          onClick={() => setDraft({ ...draft, rows: [...draft.rows, ["", ""]] })}>{t("issues.detail.addField")}</Button>
      </div>
    </Modal>}
  </div>;
}

type ChangesetLink = NonNullable<Issue["changesets"]>[number];

export function IssueDevelopment({ issue, context, editable, busy, error, resetError, save }: SidebarProps & {
  context: { organizationID: string; handle: string; repository: string };
}) {
  const { t } = useTranslation("repositories");
  const { organizationID, handle, repository } = context;
  const [draft, setDraft] = useState<{ selected: ChangesetLink[]; version: string }>();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ChangesetLink[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [retry, setRetry] = useState(0);
  const open = Boolean(draft);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setStatus("loading");
    const timer = window.setTimeout(async () => {
      try {
        const { items } = await changesetAPI.list(organizationID, { repository, q: query.trim() }, controller.signal);
        if (controller.signal.aborted) return;
        setCandidates(items.map(({ changeset: { id, title } }) => ({ id, title })));
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, organizationID, repository, query, retry]);

  const label = t("issues.detail.development");
  const linked = issue.changesets ?? [];
  const selected = new Set(draft?.selected.map(({ id }) => id));
  const choices = [...(draft?.selected ?? []), ...(status === "ready" ? candidates.filter(({ id }) => !selected.has(id)) : [])];
  return <div className="issue-sidebar-section">
    <div className="issue-sidebar-heading">
      <h3>{label}</h3>
      {editable && <Button variant="ghost" size="small" disabled={busy} aria-label={t("issues.detail.editMetadata", { field: label })}
        onClick={() => { resetError(); setQuery(""); setStatus("loading"); setDraft({ selected: linked, version: issue.updated_at }); }}>
        <Settings size={15} aria-hidden="true" />
      </Button>}
    </div>
    {linked.length ? <ul>{linked.map(({ id, title }) => <li key={id}><Link to={changesetPath(handle, id)}>{title}</Link></li>)}</ul>
      : <p className="issue-sidebar-empty">{t("issues.detail.noChangesets")}</p>}
    <IssueBranches key={issue.id} issue={issue} context={context} editable={editable} />
    {editable && <Link to={`${pullRequestComparePath(handle, repository)}?issue=${issue.number}`}>{t("issues.detail.createPullRequest")}</Link>}
    {draft && <Modal open title={label} okText={t("common:actions.save")} confirmLoading={busy} onCancel={() => setDraft(undefined)}
      onOk={() => save({ changeset_ids: draft.selected.map(({ id }) => id), expected_updated_at: draft.version }, () => setDraft(undefined))}>
      {error && <p role="alert">{error}</p>}
      <div className="issue-detail__sidebar-editor">
        <Input label={t("issues.detail.searchChangesets")} value={query} disabled={busy}
          onChange={(event) => { setStatus("loading"); setQuery(event.target.value); }} />
        {status === "loading" && <p role="status">{t("common:components.loading")}</p>}
        {status === "error" && <p role="alert">{t("issues.detail.linksFailed")} <Button variant="ghost" size="small" onClick={() => setRetry(retry + 1)}>{t("issues.composer.retry")}</Button></p>}
        {status === "ready" && choices.length === 0 && <p>{t("issues.detail.noChangesets")}</p>}
        {choices.map((choice) => <Checkbox key={choice.id} label={choice.title} checked={selected.has(choice.id)} disabled={busy || (!selected.has(choice.id) && selected.size >= 100)}
          onChange={(event) => setDraft({ ...draft, selected: event.target.checked ? [...draft.selected, choice] : draft.selected.filter(({ id }) => id !== choice.id) })} />)}
      </div>
    </Modal>}
  </div>;
}
