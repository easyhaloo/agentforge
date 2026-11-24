import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { APIError, translateError } from "../../shared/api/errors";
import type { OrganizationSummary } from "../../shared/api/identity";
import { issuesAPI, type IssuePage } from "../../shared/api/issues";
import { issueDetailPath } from "../../shared/routing";
import { Button, Input, Modal } from "../../shared/ui";

const pageSize = 20;

export function PullRequestIssueLinks({ organization, repository, pullID, handle, editable }: {
  organization: OrganizationSummary;
  repository: string;
  pullID: string;
  handle: string;
  editable: boolean;
}) {
  const { t } = useTranslation(["pulls", "common"]);
  const heading = useId();
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<IssuePage>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const manage = editable && (organization.role === "admin" || organization.role === "owner");
  const input = draft?.trim().replace(/^#/, "") ?? "";
  const number = Number(input);
  const invalid = !/^[1-9]\d*$/.test(input) || number > 2147483647;

  useEffect(() => {
    const controller = new AbortController();
    setPage(undefined);
    setLoadFailed(false);
    void issuesAPI.list(organization.id, { repository, linked_changeset: pullID, limit: pageSize, offset }, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        if (offset > 0 && offset >= result.total) setOffset(Math.max(0, offset - pageSize));
        else setPage(result);
      })
      .catch(() => { if (!controller.signal.aborted) setLoadFailed(true); });
    return () => controller.abort();
  }, [organization.id, repository, pullID, offset, refresh]);

  async function save(issueNumber: number, link: boolean) {
    if (!manage || busy) return;
    setBusy(true);
    setError("");
    try {
      const issue = await issuesAPI.get(organization.id, issueNumber, repository);
      if (issue.repository !== repository || issue.number !== issueNumber) {
        setError(t("development.missing"));
        return;
      }
      const links = new Set(issue.changesets?.map(({ id }) => id));
      if (link !== links.has(pullID)) {
        if (link) links.add(pullID);
        else links.delete(pullID);
        await issuesAPI.update(organization.id, issueNumber, repository, {
          changeset_ids: [...links], expected_updated_at: issue.updated_at,
        });
      }
      setDraft(undefined);
      if (link) setOffset(0);
      setRefresh(value => value + 1);
    } catch (cause) {
      setError(cause instanceof APIError && cause.status === 404 ? t("development.missing") : translateError(cause, t, "pulls:development.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <section className="pull-reviewers" aria-labelledby={heading}>
    <h3 id={heading}>{t("development.title")}</h3>
    {loadFailed ? <div role="alert">{t("development.loadFailed")} <Button size="small" variant="ghost"
      onClick={() => setRefresh(value => value + 1)}>{t("common:actions.retry")}</Button></div>
      : !page ? <p role="status">{t("common:components.loading")}</p>
      : page.items.length === 0 ? <p>{t("development.empty")}</p>
      : <ul className="pull-issue-links">{page.items.map(issue => <li key={issue.id}>
        <Link to={issueDetailPath(handle, repository, issue.number)}>#{issue.number} {issue.title}</Link>
        {manage && <Button size="small" variant="ghost" disabled={busy}
          aria-label={t("development.unlink", { number: issue.number })}
          onClick={() => void save(issue.number, false)}>{t("development.unlinkAction")}</Button>}
      </li>)}</ul>}
    {page && page.total > pageSize && <div className="org-actions">
      <Button size="small" disabled={busy || offset === 0} onClick={() => setOffset(offset - pageSize)}>{t("common:actions.previous")}</Button>
      <Button size="small" disabled={busy || offset + pageSize >= page.total} onClick={() => setOffset(offset + pageSize)}>{t("common:actions.next")}</Button>
    </div>}
    {manage && <Button size="small" disabled={busy} onClick={() => { setError(""); setDraft(""); }}>{t("development.open")}</Button>}
    {error && draft === undefined && <p role="alert">{error}</p>}
    {draft !== undefined && <Modal open title={t("development.open")} okText={t("development.link")} okDisabled={invalid}
      confirmLoading={busy} onCancel={() => { if (!busy) setDraft(undefined); }} onOk={() => save(number, true)}>
      <Input autoFocus label={t("development.number")} inputMode="numeric" value={draft} disabled={busy}
        onChange={event => { setDraft(event.target.value); setError(""); }} />
      {error && <p role="alert">{error}</p>}
    </Modal>}
  </section>;
}
