import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { type OrganizationSummary } from "../../shared/api/identity";
import { pipelines, type Definition, type Pipeline, type Summary } from "../../shared/api/pipelines";
import { Button, ConfirmDialog, Select, TextArea } from "../../shared/ui";

import { RunPanel } from "./RunPanel";
import { editable, WorkflowEditor } from "./WorkflowEditor";

const template: Definition = {
  apiVersion: "agentforge.dev/v1", name: "release",
  stages: [{ id: "review", jobs: [{ id: "gate", steps: [{ id: "approve", uses: "control/approval@v1" }] }] }],
};
const checkTemplate: Definition = {
  ...template, name: "check-and-approve", stages: [
    { id: "verify", jobs: [{ id: "checks", steps: [{ id: "check", uses: "container/check@v1" }] }] }, ...template.stages,
  ],
};
const format = (value: Definition) => JSON.stringify(value, null, 2);

export function PipelinesPage({ organization }: { organization: OrganizationSummary }) {
  const { t } = useTranslation("pipelines");
  const org = organization.id;
  const [items, setItems] = useState<Summary[]>([]);
  const [selected, select] = useState<Pipeline | null>(null);
  const [text, edit] = useState(format(template));
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [confirmation, confirm] = useState<{ title: string; run: () => void } | null>(null);
  const [visual, setVisual] = useState(false);
  const canEdit = organization.role !== "viewer" && selected?.status !== "archived";
  const canPublish = organization.role === "owner" || organization.role === "admin";
  const dirty = text !== format(selected?.definition ?? template);
  useEffect(() => {
    let active = true;
    pipelines.list(org).then(({ items }) => { if (active) setItems(items); })
      .catch((cause: Error) => { if (active) setError(cause.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [org]);
  function display(p: Pipeline | null) {
    setVisual(false); select(p); edit(format(p?.definition ?? template)); setError("");
  }
  async function apply(operation: () => Promise<Pipeline>) {
    setBusy(true); setError("");
    try {
      const p = await operation();
      display(p); setItems(list => [...list.filter(item => item.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("requestFailed")); }
    finally { setBusy(false); }
  }
  function leaveEditor(run: () => void) {
    if (dirty) confirm({ title: t("discard"), run }); else run();
  }
  return <section className="org-admin">
    <h2>{t("title")}</h2>
    <Select label={t("workflow")} disabled={busy} value={selected?.id ?? ""}
      placeholder={organization.role === "viewer" ? t("selectWorkflow") : t("newWorkflow")}
      options={items.map(p => ({ value: p.id, label: `${p.name} · ${t(p.status)}` }))}
      onChange={e => {
        const id = e.target.value;
        leaveEditor(() => { if (id) void apply(() => pipelines.get(org, id)); else display(null); });
      }} />
    {!selected && canEdit && <Select label={t("template")} value="" disabled={busy} placeholder={t("selectTemplate")}
      options={[{ value: "approval", label: t("approval") }, { value: "check", label: t("checkAndApprove") }]}
      onChange={e => {
        const next = e.target.value === "check" ? checkTemplate : template;
        leaveEditor(() => { edit(format(next)); setVisual(true); setError(""); });
      }} />}
    {error && <p className="org-error" role="alert">{error}</p>}
    {selected && <p role="status">{t("revision", {status:t(selected.status), revision:selected.revision, version:selected.version})}</p>}
    {canEdit && <Button disabled={busy} onClick={() => {
      if (!visual) {
        try {
          const parsed: Definition = JSON.parse(text);
          if (!editable(parsed)) throw new Error();
        } catch { setError(t("fixJSON")); return; }
      }
      setError(""); setVisual(!visual);
    }}>{visual ? t("editJSON") : t("visual")}</Button>}
    {visual && canEdit ? <fieldset disabled={busy}><WorkflowEditor definition={JSON.parse(text)} update={d => edit(format(d))} /></fieldset> : (selected || canEdit) && <TextArea label={t("json")} rows={18} spellCheck={false} value={text} readOnly={!canEdit || busy} onChange={e => edit(e.target.value)} />}

    <div className="action-row">
      {canEdit && <Button disabled={busy || (!!selected && !dirty)} onClick={() => void apply(() => {
        const definition: Definition = JSON.parse(text);
        return selected ? pipelines.save(org, selected, definition) : pipelines.create(org, definition);
      })}>{selected ? t("save") : t("create")}</Button>}
      {selected && organization.role !== "viewer" && <Button disabled={busy} onClick={() => leaveEditor(() => {
        const copy = { ...selected.definition, name: `${selected.name.slice(0, 59)}-copy` };
        display(null); edit(format(copy)); setVisual(true);
      })}>{t("clone")}</Button>}
      {selected && <Button disabled={busy} onClick={() => { leaveEditor(() => void apply(() => pipelines.get(org, selected.id))); }}>{t("reload")}</Button>}
      {selected && canPublish && selected.status === "draft" && <Button disabled={busy || dirty} onClick={() => void apply(() => pipelines.transition(org, selected, "publish"))}>{t("publish")}</Button>}
      {selected && canPublish && selected.status !== "archived" && <Button disabled={busy || dirty} onClick={() => {
        confirm({ title: t("confirmArchive", {name:selected.name}), run: () => void apply(() => pipelines.transition(org, selected, "archive")) });
      }}>{t("archive")}</Button>}
    </div>
    {selected && selected.version > 0 && <RunPanel key={`${selected.id}:${selected.version}`} org={org} pipeline={selected} canStart={canEdit} />}
    <ConfirmDialog open={Boolean(confirmation)} title={confirmation?.title} description={dirty ? t("editsLost") : t("versionsRemain")}
      onCancel={() => confirm(null)} onConfirm={() => { confirmation?.run(); confirm(null); }} />
  </section>;
}
