import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { APIError, translateError } from "../../shared/api/errors";
import { repositoryPreviewAPI, type RepositoryPreviewRefs } from "../../shared/api/identity";
import { issueConversationAPI } from "../../shared/api/issue-conversation";
import type { Issue } from "../../shared/api/issues";
import { repositoryPath } from "../../shared/routing";
import { Button, Input, Modal, Select } from "../../shared/ui";
import type { IssueContext } from "./IssueConversation";

export function IssueBranches({ issue, context, editable }: { issue: Issue; context: IssueContext; editable: boolean }) {
  const { t } = useTranslation("repositories");
  const { organizationID, repository, handle } = context;
  const [refs, setRefs] = useState<RepositoryPreviewRefs>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState<{ name: string; base: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prefix = `agentforge/issues/${issue.id}/`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    void repositoryPreviewAPI.refs(organizationID, repository).then((result) => {
      if (active) setRefs(result);
    }, () => {
      if (active) setFailed(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [organizationID, repository, retry]);

  const branches = refs?.items.filter((ref) => ref.kind === "branch") ?? [];
  const linked = branches.filter(({ name }) => name.startsWith(prefix));
  const defaultBase = branches.find(({ name }) => name === refs?.default_branch) ?? branches[0];
  const base = draft?.base ? branches.find(({ name }) => name === draft.base) : defaultBase;
  const valid = Boolean(draft && /^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/.test(draft.name));
  const reload = () => {
    setError("");
    setRetry((value) => value + 1);
  };
  const submit = async () => {
    if (!draft || !base || !valid || loading || failed || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await issueConversationAPI(organizationID, repository, issue.number).createBranch(draft.name, base);
      setRefs((current) => current && { ...current, items: [...current.items.filter(({ name, kind }) => name !== created.name || kind !== created.kind), created] });
      setDraft(undefined);
    } catch (cause) {
      setError(cause instanceof APIError && cause.status === 409
        ? t("issues.detail.branchConflict") : translateError(cause, t, "issues.detail.branchFailed"));
    } finally {
      setBusy(false);
    }
  };
  const caption = t("issues.detail.createBranch");
  return <>
    {linked.length > 0 && <ul>{linked.map(({ name }) => <li key={name}>
      <Link title={name} to={`${repositoryPath(handle, repository)}?${new URLSearchParams({ ref: `refs/heads/${name}` })}`}>{name.slice(prefix.length)}</Link>
    </li>)}</ul>}
    {editable && <div><Button variant="ghost" size="small" onClick={() => {
      setError("");
      setDraft({ name: `issue-${issue.number}`, base: "" });
    }}>{caption}</Button></div>}
    {draft && <Modal open title={caption} okText={caption} confirmLoading={busy} onCancel={() => setDraft(undefined)}
      okDisabled={!valid || !base || loading || failed} onOk={submit}>
      <div className="issue-detail__sidebar-editor">
        <Input label={t("issues.detail.branchName")} value={draft.name} maxLength={80} disabled={busy}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <p className="issue-sidebar-empty">{t("issues.detail.branchNameHint")} <code>{prefix}{draft.name}</code></p>
        <Select label={t("issues.detail.branchBase")} value={base?.name ?? ""} disabled={busy || loading || failed || branches.length === 0}
          options={branches.map(({ name }) => ({ label: name, value: name }))}
          onChange={(event) => setDraft({ ...draft, base: event.target.value })} />
        {loading && <p role="status">{t("common:components.loading")}</p>}
        {!loading && !failed && branches.length === 0 && <p role="status">{t("issues.detail.branchNoBase")}</p>}
        {(failed || error) && <p role="alert">{error || t("issues.detail.branchLoadFailed")}</p>}
        {!loading && (failed || error || !base) && <Button variant="ghost" size="small" disabled={busy} onClick={reload}>{t("issues.detail.branchReload")}</Button>}
      </div>
    </Modal>}
  </>;
}
