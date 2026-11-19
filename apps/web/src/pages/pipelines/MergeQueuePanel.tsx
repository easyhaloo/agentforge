import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../shared/api/errors";
import { pipelines, type Pipeline, type QueueEntry } from "../../shared/api/pipelines";
import { Button, Input } from "../../shared/ui";

import { type DraftRun, RunDialog } from "./RunPanel";

interface Props {
  org: string; pipeline: Pipeline; draft?: DraftRun; canStart: boolean; canPromote: boolean;
}

export function MergeQueuePanel({ org, pipeline, draft, canStart, canPromote }: Props) {
  const { t } = useTranslation("pipelines");
  const [enqueue, setEnqueue] = useState(false);
  const [repo, setRepo] = useState("");
  const [target, setTarget] = useState("main");
  const [source, setSource] = useState("");
  const [entries, setEntries] = useState<QueueEntry[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh(operation?: () => Promise<unknown>) {
    setBusy(true); setError("");
    try {
      await operation?.();
      setEntries((await pipelines.queue(org, repo, target)).items);
    } catch (e) { setError(translateError(e, t, "pipelines:errors.queueFailed")); }
    finally { setBusy(false); }
  }
  return <details><summary>{t("mergeQueue")}</summary><fieldset disabled={busy}>
    <Input label={t("queueRepo")} value={repo} onChange={e => { setRepo(e.target.value); setEntries(undefined); }} />
    <Input label={t("queueTarget")} value={target} onChange={e => { setTarget(e.target.value); setEntries(undefined); }} />
    <Button disabled={!repo || !target} onClick={() => void refresh()}>{t("refreshQueue")}</Button>
    {canStart && <><Input label={t("queueSource")} value={source} onChange={e => setSource(e.target.value)} />
      <Button disabled={!repo || !target || !source} onClick={() => setEnqueue(true)}>{t("enqueue")}</Button></>}
    {entries?.length === 0 && <p>{t("queueEmpty")}</p>}
    <ol>{entries?.map((entry,index) => <li key={entry.id}>
      {entry.source} <code>{entry.sourceSHA.slice(0,12)}</code> · {t(entry.status)} {entry.candidateSHA && <code>{entry.candidateSHA}</code>}
      {canStart && <Button onClick={() => void refresh(() => pipelines.cancelEntry(org,entry.id))}>{t("cancelEntry")}</Button>}
      {canPromote && index === 0 && entry.status === "ready" && entry.runId && entry.candidateSHA && <Button onClick={() => void refresh(() => pipelines.promote(org,entry.runId!,entry.candidateSHA!))}>{t("promoteCandidate")}</Button>}
    </li>)}</ol>
  </fieldset>{error && <p role="alert">{error}</p>}{enqueue && <RunDialog queue draft={draft} org={org} pipeline={pipeline} onCancel={() => setEnqueue(false)} onSubmit={async (version, inputs) => {
    await pipelines.enqueue(org, pipeline.id, version.number, { repository: repo, target, sources: [source], inputs });
    await refresh();
  }} />}</details>;
}
