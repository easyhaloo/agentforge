import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../shared/api/errors";
import { pipelines, type Summary, type WorkflowTrigger, type WorkflowTriggerKind } from "../../shared/api/pipelines";
import { Button, Input, Modal, Select } from "../../shared/ui";

const kinds: WorkflowTriggerKind[] = ["changeset_revision", "schedule", "tag"];

export function WorkflowTriggers({ org, workflow, canManage, onClose }: {
  org: string; workflow: Summary; canManage: boolean; onClose: () => void;
}) {
  const { t } = useTranslation("repositories");
  const [items, setItems] = useState<WorkflowTrigger[]>();
  const [kind, setKind] = useState<WorkflowTriggerKind>("changeset_revision");
  const [interval, setInterval] = useState("60");
  const [tagPattern, setTagPattern] = useState("v*");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const { id, version, status, disabled } = workflow;
  const available = kinds.filter(value => !items?.some(item => item.kind === value));
  const selected = available.includes(kind) ? kind : available[0];
  const validInterval = Number.isInteger(Number(interval)) && Number(interval) >= 1 && Number(interval) <= 525600;
  const validTagPattern = /^[^/\s\\\x00-\x1f]{1,128}$/.test(tagPattern);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void pipelines.triggers(org, id, signal).then(data => {
      if (!signal.aborted) setItems(data.items ?? []);
    }, cause => {
      if (!signal.aborted) setError(translateError(cause, t, "repositories:actions.triggers.failed"));
    });
    return () => controller.abort();
  }, [org, id, retry, t]);

  async function update(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(translateError(cause, t, "repositories:actions.triggers.failed"));
      setItems(undefined);
      setRetry(n => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return <Modal open title={t("actions.triggers.title")} onCancel={onClose} cancelText={t("common:actions.close")}
    confirmLoading={busy} okText={t("actions.triggers.enable")} okDisabled={!selected || (selected === "schedule" && !validInterval) || (selected === "tag" && !validTagPattern)}
    onOk={items && canManage && version > 0 && status !== "archived" && !disabled && selected ? () => update(async () => {
      const binding = await pipelines.enableTrigger(org, id, { kind: selected, version,
        ...(selected === "schedule" && { everySeconds: Number(interval) * 60 }),
        ...(selected === "tag" && { tagPattern }) });
      setItems(previous => [...(previous ?? []), binding]);
    }) : undefined}>
    <p>{t("actions.triggers.hint")}</p>
    {error && <p role="alert">{error} {!items && <Button onClick={() => { setError(""); setRetry(n => n + 1); }}>{t("common:actions.retry")}</Button>}</p>}
    {!items && !error && <p role="status">{t("common:status.loading")}</p>}
    {items?.length === 0 && <p>{t("actions.triggers.empty")}</p>}
    {items && items.length > 0 && <ul className="repo-workflow-triggers">{items.map(item => <li key={item.id}>
      <span>{t(`actions.events.${item.kind}`)} · {t("actions.version", { version: item.version })}
        {item.everySeconds && <> · {t("actions.triggers.interval", { count: item.everySeconds / 60 })}</>}
        {item.tagPattern && <> · <code>{item.tagPattern}</code></>}</span>
      {canManage && <Button size="small" disabled={busy} onClick={() => void update(async () => {
        await pipelines.disableTrigger(org, id, item.id);
        setItems(previous => previous?.filter(row => row.id !== item.id));
      })}>{t("actions.triggers.disable")}</Button>}
    </li>)}</ul>}
    {canManage && !version && <p>{t("actions.draftHint")}</p>}
    {items && canManage && version > 0 && status !== "archived" && !disabled && selected && <div className="repo-workflow-trigger-form">
      <Select label={t("actions.event")} value={selected} disabled={busy} onChange={event => {
        const value = available.find(candidate => candidate === event.target.value);
        if (value) setKind(value);
      }} options={available.map(value => ({ value, label: t(`actions.events.${value}`) }))} />
      {selected === "schedule" && <Input type="number" min={1} max={525600} step={1} disabled={busy} label={t("actions.triggers.minutes")} value={interval} onChange={event => setInterval(event.target.value)} />}
      {selected === "tag" && <Input disabled={busy} label={t("actions.triggers.tagPattern")} value={tagPattern} maxLength={128} error={!validTagPattern ? t("actions.triggers.tagPatternHint") : undefined}
        onChange={event => setTagPattern(event.target.value)} />}
      <small>{t("actions.triggers.bindVersion", { version })}</small>
    </div>}
  </Modal>;
}
