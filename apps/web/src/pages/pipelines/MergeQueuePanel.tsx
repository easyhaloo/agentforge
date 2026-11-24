import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../shared/api/errors";
import { pipelines, type Pipeline, type QueueEntry } from "../../shared/api/pipelines";
import { Button, Input } from "../../shared/ui";

import { type DraftRun, RunDialog } from "./RunPanel";

interface Props {
  initial?: { repository: string; target: string; source: string };
  org: string; pipeline: Pipeline; draft?: DraftRun; canStart: boolean; canPromote: boolean;
}

export function MergeQueuePanel({ initial, org, pipeline, draft, canStart, canPromote }: Props) {
  const { t } = useTranslation("pipelines");
  const [open, setOpen] = useState(Boolean(initial));
  const [enqueue, setEnqueue] = useState(false);
  const [repo, setRepo] = useState(initial?.repository ?? "");
  const [target, setTarget] = useState(initial?.target ?? "main");
  const [source, setSource] = useState(initial?.source ?? "");
  const [entries, setEntries] = useState<QueueEntry[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);
  const repository = repo.trim();
  const targetBranch = target.trim();

  useEffect(() => {
    setEntries(undefined);
    setError("");
    setLoading(open && !!repository && !!targetBranch);
    if (!open || !repository || !targetBranch) return;

    const controller = new AbortController();
    const { signal } = controller;
    async function readQueue() {
      try {
        const { items } = await pipelines.queue(org, repository, targetBranch, signal);
        if (signal.aborted) return;
        setEntries(items);
        timer = window.setTimeout(readQueue, 3000);
      } catch (e) {
        if (signal.aborted) return;
        setEntries(undefined);
        setError(translateError(e, t, "pipelines:errors.queueFailed"));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
    let timer = window.setTimeout(readQueue, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, org, repository, targetBranch, queueVersion, t]);

  function loadQueue() {
    setEntries(undefined);
    setQueueVersion(version => version + 1);
  }

  async function mutate(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      loadQueue();
    } catch (e) { setError(translateError(e, t, "pipelines:errors.queueFailed")); }
    finally { setBusy(false); }
  }
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)}><summary>{t("mergeQueue")}</summary><fieldset disabled={busy}>
    <Input label={t("queueRepo")} value={repo} onChange={e => setRepo(e.target.value)} />
    <Input label={t("queueTarget")} value={target} onChange={e => setTarget(e.target.value)} />
    {canStart && <><Input label={t("queueSource")} value={source} onChange={e => setSource(e.target.value)} />
      <Button disabled={!repository || !targetBranch || !source} onClick={() => setEnqueue(true)}>{t("enqueue")}</Button></>}
    {loading && <p role="status">{t("common:status.loading")}</p>}
    {entries?.length === 0 && <p>{t("queueEmpty")}</p>}
    <ol>{entries?.map((entry,index) => <li key={entry.id}>
      {entry.source} <code>{entry.sourceSHA.slice(0,12)}</code> · {t(entry.status)} {entry.candidateSHA && <code>{entry.candidateSHA}</code>}
      {canStart && <Button onClick={() => void mutate(() => pipelines.cancelEntry(org,entry.id))}>{t("cancelEntry")}</Button>}
      {canPromote && index === 0 && entry.status === "ready" && entry.runId && entry.candidateSHA && <Button onClick={() => void mutate(() => pipelines.promote(org,entry.runId!,entry.candidateSHA!))}>{t("promoteCandidate")}</Button>}
    </li>)}</ol>
  </fieldset>{error && <p role="alert">{error} {!entries && <Button onClick={loadQueue}>{t("common:actions.retry")}</Button>}</p>}{enqueue && <RunDialog queue draft={draft} org={org} pipeline={pipeline} onCancel={() => setEnqueue(false)} onSubmit={async (version, inputs) => {
    await pipelines.enqueue(org, pipeline.id, version.number, { repository, target: targetBranch, sources: [source], inputs });
    loadQueue();
  }} />}</details>;
}
