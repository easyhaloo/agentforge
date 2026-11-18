import { useEffect, useState } from "react";
import { type OrganizationSummary } from "../../shared/api/identity";
import { pipelines, type Definition, type Pipeline, type Summary } from "../../shared/api/pipelines";
import { Button, ConfirmDialog, Select, TextArea } from "../../shared/ui";

const template: Definition = {
  apiVersion: "agentforge.dev/v1", name: "release",
  stages: [{ id: "review", jobs: [{ id: "gate", steps: [{ id: "approve", uses: "control/approval@v1" }] }] }],
};
const format = (value: Definition) => JSON.stringify(value, null, 2);

export function PipelinesPage({ organization }: { organization: OrganizationSummary }) {
  const org = organization.id;
  const [items, setItems] = useState<Summary[]>([]);
  const [selected, select] = useState<Pipeline | null>(null);
  const [text, edit] = useState(format(template));
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [confirmation, confirm] = useState<{ title: string; run: () => void } | null>(null);
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
    select(p); edit(format(p?.definition ?? template)); setError("");
  }
  async function apply(operation: () => Promise<Pipeline>) {
    setBusy(true); setError("");
    try {
      const p = await operation();
      display(p); setItems(list => [...list.filter(item => item.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Pipeline request failed"); }
    finally { setBusy(false); }
  }
  function leaveEditor(run: () => void) {
    if (dirty) confirm({ title: "Discard unsaved changes?", run }); else run();
  }
  return <section className="org-admin">
    <h2>Pipelines</h2>
    <Select label="Workflow" disabled={busy} value={selected?.id ?? ""}
      placeholder={organization.role === "viewer" ? "Select a workflow" : "New workflow"}
      options={items.map(p => ({ value: p.id, label: `${p.name} · ${p.status}` }))}
      onChange={e => {
        const id = e.target.value;
        leaveEditor(() => { if (id) void apply(() => pipelines.get(org, id)); else display(null); });
      }} />
    {error && <p className="org-error" role="alert">{error}</p>}
    {selected && <p role="status">{selected.status} · Revision {selected.revision} · Published version {selected.version}</p>}
    {(selected || canEdit) && <TextArea label="Workflow definition (JSON)" rows={18} spellCheck={false} value={text} readOnly={!canEdit || busy} onChange={e => edit(e.target.value)} />}
    <div className="action-row">
      {canEdit && <Button disabled={busy || (!!selected && !dirty)} onClick={() => void apply(() => {
        const definition: Definition = JSON.parse(text);
        return selected ? pipelines.save(org, selected, definition) : pipelines.create(org, definition);
      })}>{selected ? "Save draft" : "Create draft"}</Button>}
      {selected && <Button disabled={busy} onClick={() => { leaveEditor(() => void apply(() => pipelines.get(org, selected.id))); }}>Reload workflow</Button>}
      {selected && canPublish && selected.status === "draft" && <Button disabled={busy || dirty} onClick={() => void apply(() => pipelines.transition(org, selected, "publish"))}>Publish version</Button>}
      {selected && canPublish && selected.status !== "archived" && <Button disabled={busy || dirty} onClick={() => {
        confirm({ title: `Archive ${selected.name}?`, run: () => void apply(() => pipelines.transition(org, selected, "archive")) });
      }}>Archive workflow</Button>}
    </div>
    <ConfirmDialog open={Boolean(confirmation)} title={confirmation?.title} description={dirty ? "Your edits will be lost." : "Published versions will remain available."}
      onCancel={() => confirm(null)} onConfirm={() => { confirmation?.run(); confirm(null); }} />
  </section>;
}
