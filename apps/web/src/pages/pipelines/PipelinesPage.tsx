import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { translateError } from "../../shared/api/errors";
import { type OrganizationSummary } from "../../shared/api/identity";
import { pipelines, type Definition, type Pipeline, type Summary } from "../../shared/api/pipelines";
import { Button, ConfirmDialog, DataTable, Empty, Input, Modal, RadioGroup } from "../../shared/ui";

import { Link, useBlocker, useNavigate, useSearchParams } from "react-router-dom";
import { organizationHandle, orgPath, pipelineEditPath, pipelineRunPath, repositoryActionsBackPath, repositoryActionsContext } from "../../shared/routing";
import { ArrowLeft, Play, Plus, Workflow } from "lucide-react";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { MergeQueuePanel } from "./MergeQueuePanel";
import { RunDialog } from "./RunPanel";
import { editable, outputNameError, workflowOutputNames, WorkflowEditor } from "./WorkflowEditor";

const template: Definition = {
  apiVersion: "agentforge.dev/v1", name: "release",
  stages: [{ id: "review", jobs: [{ id: "gate", steps: [{ id: "approve", uses: "control/approval@v1" }] }] }],
};
const checkTemplate: Definition = {
  ...template, name: "check-and-approve", stages: [
    { id: "verify", jobs: [{ id: "checks", steps: [{ id: "check", uses: "container/check@v1" }] }] }, ...template.stages,
  ],
};

const scriptTemplate: Definition = {
  ...template, name: "script-release",
  parameters: [{ name: "VERSION", type: "string", default: "1.0.0", override: true }],
  stages: [
    { id: "build", jobs: [{ id: "package", steps: [{ id: "make-tag", uses: "container/script@v1",
      script: `printf 'TAG=v%s\\n' "$AF_PARAM_VERSION" >> "$FLOW_ENV"`, outputs: ["TAG"] }] }] },
    { id: "release", dependsOn: ["build"], jobs: [{ id: "publish", steps: [{ id: "read-tag", uses: "container/script@v1",
      script: `printf 'Release %s\\n' "$AF_VAR_TAG"` }] }] },
  ],
};
const templates = [
  { definition: template, label: "approval" },
  { definition: checkTemplate, label: "checkAndApprove" },
  { definition: scriptTemplate, label: "scriptFlow" },
];

export function PipelinesPage({ organization }: { organization: OrganizationSummary }) {
  const { t } = useTranslation("pipelines");
  const org = organization.id;
  const [search] = useSearchParams();
  const queue = mergeQueueContext(search);
  const queueSearch = queue ? `?${search}` : "";
  const [items, setItems] = useState<Summary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let active = true;
    setBusy(true); setError("");
    pipelines.list(org).then(({ items }) => { if (active) setItems(items); })
      .catch((cause: unknown) => { if (active) setError(translateError(cause, t, "pipelines:errors.requestFailed")); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [org, t]);
  return <>
    <section className="org-admin wf-workspace">
      {queue && <p>{t("chooseQueueWorkflow")}</p>}
      {error && <p className="org-error" role="alert">{error}</p>}
      <header className="wf-list-header">
        <h2><Workflow size={17} aria-hidden="true" />{t("title")} {!busy && !error && <small>{items.length}</small>}</h2>
        {organization.role !== "viewer" && <Button variant="primary" disabled={busy || creating} onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden="true" /> {t("common:actions.create")}
        </Button>}
      </header>
      <DataTable<Summary> showColumnVisibility={false} aria-label={t("title")} rowKey="id" data={items} loading={busy}
        emptyText={<Empty icon={<Workflow />} title={t("empty")} description={organization.role !== "viewer" && t("emptyHint")} />}
        columns={[
          {key:"name", title:t("workflowName"), render:(_, row) => <Link to={pipelineEditPath(organizationHandle(organization), row.id) + queueSearch}><Workflow size={16} />{row.name}</Link>},
          {key:"status", title:t("status"), render:(_, row) => <span className="wf-badge" data-state={row.status}>{t(row.status)}</span>},
          {key:"revision", title:t("revisionLabel")}, {key:"version", title:t("version")},
        ]} />
    </section>
    {creating && <CreatePipelineDialog organization={organization} onClose={() => setCreating(false)} />}
  </>;
}

function mergeQueueContext(search: URLSearchParams) {
  const repository = search.get("queueRepository");
  const target = search.get("queueTarget");
  const source = search.get("queueSource");
  if (repository && target && source) return { repository, target, source };
}

export function CreatePipelineDialog({ organization, copy, onClose, repository }: {
  organization: OrganizationSummary; copy?: Definition; onClose: () => void; repository?: string;
}) {
  const { t } = useTranslation("pipelines");
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [creation, setCreation] = useState(copy ?? template);
  const [nameError, setNameError] = useState(false);
  const clone = Boolean(copy);
  return (
    <Modal open title={t(clone ? "clone" : "createPipeline")} onCancel={onClose} okText={t("common:actions.create")} onOk={async () => {
      if (organization.role === "viewer") return;
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(creation.name)) {
        setNameError(true);
        return;
      }
      const pipeline = await pipelines.create(organization.id, creation, repository);
      onClose();
      const path = pipelineEditPath(organizationHandle(organization), pipeline.id);
      const filters = new URLSearchParams(search);
      filters.delete("offset");
      filters.set("workflow", pipeline.id);
      void navigate(repository ? path + repositoryActionsContext(repository, filters) : path);
    }}>
      <div className="wf-create-fields">
        {!clone && <RadioGroup label={t("template")} name="pipeline-template" value={templates.find(item => item.definition.stages === creation.stages)?.label}
          options={templates.map(({ label }) => ({ value: label, label: t(label) }))}
          onChange={value => {
            const next = templates.find(item => item.label === value)!.definition;
            const customName = !templates.some(item => creation.name === item.definition.name);
            setCreation({ ...next, name: customName ? creation.name : next.name });
          }} />}
        <Input label={t("workflowName")} value={creation.name} maxLength={64} error={nameError ? t("nameHint") : undefined}
          onChange={e => { setNameError(false); setCreation({ ...creation, name:e.target.value }); }} />
      </div>
    </Modal>
  );
}

export function PipelineEditorPage({ organization, id }: { organization: OrganizationSummary; id: string }) {
  const { t } = useTranslation("pipelines");
  const org = organization.id;
  const handle = organizationHandle(organization);
  const [search] = useSearchParams();
  const backToActions = repositoryActionsBackPath(handle, search);
  const queue = mergeQueueContext(search);
  const [selected, select] = useState<Pipeline | null>(null);
  const [edits, setDraft] = useState<Definition | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [cloning, setCloning] = useState(false);
  const [runDialog, setRunDialog] = useState(false);
  const navigate = useNavigate();
  const startedRunPath = useRef<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [retry, setRetry] = useState(0);
  const draft = edits ?? selected?.definition ?? template;
  const dirty = edits !== null && JSON.stringify(edits) !== JSON.stringify(selected?.definition);
  const blocker = useBlocker(({ nextLocation }) => dirty && nextLocation.pathname !== startedRunPath.current);
  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    let active = true;
    setBusy(true); setError("");
    pipelines.get(org, id).then(p => { if (active) select(p); })
      .catch(cause => { if (active) setError(translateError(cause, t, "pipelines:errors.requestFailed")); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [org, id, retry, t]);
  async function apply(operation: () => Promise<Pipeline>) {
    setBusy(true); setError("");
    try { select(await operation()); setDraft(null); }
    catch (cause) { setError(translateError(cause, t, "pipelines:errors.requestFailed")); }
    finally { setBusy(false); }
  }
  const canEdit = organization.role !== "viewer" && selected?.status !== "archived";
  const canPublish = organization.role === "owner" || organization.role === "admin";
  const validShape = editable(draft);
  const outputNames = validShape ? workflowOutputNames(draft) : [];
  const canSave = validShape && !outputNames.some(name => outputNameError(name, outputNames));
  const draftRun = selected && validShape && (dirty || selected.status === "draft") ? {
    definition: draft,
    publish: canPublish && canSave ? async () => {
      let saved = selected;
      if (dirty) {
        saved = await pipelines.save(org, selected, draft);
        select(saved);
        setDraft(null);
      }
      const published = await pipelines.transition(org, saved, "publish");
      select(published);
      return published;
    } : undefined,
  } : undefined;
  return <main className="wf-fullscreen">
    <header className="wf-editor-heading">
      <Link to={backToActions ?? (orgPath(handle, "pipelines") + (queue ? `?${search}` : ""))}><ArrowLeft size={16}/>{backToActions ? t("repositories:actions.back") : t("backToList")}</Link>
      {selected && <>
        <div className="wf-editor-title"><h1>{selected.name}</h1>
          <span role="status">{t("revision", {status:t(selected.disabled && selected.status !== "archived" ? "disabled" : selected.status), revision:selected.revision, version:selected.version})}</span>
        </div>
        {organization.role !== "viewer" && <Button disabled={busy || dirty || !validShape} onClick={() => setCloning(true)}>{t("clone")}</Button>}
        {canPublish && selected.status === "draft" && <Button disabled={busy || dirty} onClick={() => void apply(() => pipelines.transition(org, selected, "publish"))}>{t("publish")}</Button>}
        {canPublish && selected.status !== "archived" && <Button disabled={busy || dirty} onClick={() => setArchiving(true)}>{t("archive")}</Button>}
        {canEdit && <Button variant="secondary" disabled={busy || !canSave || !dirty} onClick={() => void apply(() => pipelines.save(org, selected, draft))}>{t("save")}</Button>}
        {canEdit && <Button variant="primary" disabled={busy || selected.disabled || (selected.version === 0 && !draftRun?.publish)} onClick={() => setRunDialog(true)}><Play size={14} />{t("runAction")}</Button>}
      </>}
    </header>
    {error && <p className="org-error" role="alert">{error} {!selected && <Button onClick={() => setRetry(n => n + 1)}>{t("common:actions.retry")}</Button>}</p>}
    {!selected && busy && <p role="status">{t("common:status.loading")}</p>}
    {selected && <>
    {canEdit && validShape ? <div className="wf-editor-shell" inert={busy} aria-busy={busy}>
      <WorkflowEditor key={selected.revision} definition={draft} update={setDraft} outputNames={outputNames} />
    </div> : (validShape ? <WorkflowCanvas definition={draft}/> : <p>{t("invalidGraph")}</p>)}
    {selected.version > 0 && <MergeQueuePanel key={search.toString()} initial={queue} org={org} pipeline={selected} draft={draftRun} canStart={canEdit && !selected.disabled} canPromote={canPublish} />}
    {canEdit && !selected.disabled && runDialog && <RunDialog org={org} pipeline={selected} draft={draftRun} confirmDiscard={dirty} onCancel={() => setRunDialog(false)}
      onSubmit={async (version, inputs) => {
        const run = await pipelines.start(org, selected.id, version.number, inputs);
        startedRunPath.current = pipelineRunPath(handle, run.id);
        void navigate(startedRunPath.current + (backToActions ? `?${search}` : ""));
      }} />}
    {cloning && <CreatePipelineDialog organization={organization} copy={{ ...selected.definition, name: `${selected.name.slice(0, 59)}-copy` }} onClose={() => setCloning(false)} />}
    <ConfirmDialog open={archiving} title={t("confirmArchive", {name:selected.name})} description={t("versionsRemain")}
      onCancel={() => setArchiving(false)} onConfirm={() => { setArchiving(false); void apply(() => pipelines.transition(org, selected, "archive")); }} />
    </>}
    <ConfirmDialog open={blocker.state === "blocked"} title={t("discard")} description={t("editsLost")}
      onCancel={() => blocker.reset?.()} onConfirm={() => blocker.proceed?.()} />
  </main>;
}
