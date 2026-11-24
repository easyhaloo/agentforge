import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { changesetAPI, type OrganizationSummary, type StoredChangeset } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { Button, Input, TextArea } from "../../shared/ui";
import { getDiffFilePath, RepositoryDiffViewer } from "../repositories/RepositoryDiffViewer";
import { PullRequestConversationResolution } from "./PullRequestConversationResolution";
import type { RepositoryDiffFile } from "../repositories/repositoryDiff";

type Anchor = { path: string; side: "left" | "right"; line: number; trigger: HTMLButtonElement };
type Props = {
  files: RepositoryDiffFile[];
  organization: OrganizationSummary;
  changeset: StoredChangeset;
  pullNumber: string;
  onUpdate: (changeset: StoredChangeset) => void;
  memberName: (id: string) => string;
};

export function PullRequestFilesTab({ files, organization, changeset, pullNumber, onUpdate, memberName }: Props) {
  const { t } = useTranslation(["pulls", "common"]);
  const [filter, setFilter] = useState("");
  const [anchor, setAnchor] = useState<Anchor>();
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const revision = changeset.changeset.revisions.at(-1);
  const canWrite = organization.role !== "viewer";
  const comments = changeset.changeset.pull_request?.comments ?? [];
  const visibleFiles = useMemo(() => files.filter(file =>
    getDiffFilePath(file).toLowerCase().includes(filter.trim().toLowerCase())), [files, filter]);

  useEffect(() => { if (anchor) composer.current?.focus(); }, [anchor]);

  const closeComposer = () => {
    const trigger = anchor?.trigger;
    requestAnimationFrame(() => trigger?.focus());
    setAnchor(undefined);
    setBody("");
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!revision || !anchor || !body.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      onUpdate(await changesetAPI.addPullRequestComment(organization.id, pullNumber, body.trim(), revision.id, anchor.path, anchor.side, anchor.line));
      closeComposer();
    } catch (cause) { setError(translateError(cause, t, "pulls:conversation.commentFailed")); }
    finally { setSaving(false); }
  };

  return <div className="pull-files-tab">
    <aside className="pull-file-index">
      <Input disabled={!!anchor} label={t("pulls:files.filterFiles")} value={filter} onChange={event => setFilter(event.target.value)}/>
      <ul>{visibleFiles.map((file, index) => <li key={file.header}><a href={`#pull-file-${index}`}>{getDiffFilePath(file)}</a></li>)}</ul>
    </aside>
    <div className="pull-file-patches">
      {!visibleFiles.length && <p>{t("pulls:files.noFiles")}</p>}
      {visibleFiles.length > 0 && <RepositoryDiffViewer files={visibleFiles}
        lineControl={!canWrite ? undefined : (path, side, line) =>
          <Button variant="ghost" className="pull-line-action" disabled={!!anchor}
            aria-label={`${t("pulls:conversation.addLineComment")} · ${path} · ${t(`pulls:files.${side}`)} ${line}`}
            onClick={event => setAnchor({ path, side, line, trigger: event.currentTarget })}>{line}</Button>}
        lineDiscussion={(path, side, line) => <>
          {comments.filter(comment => comment.revision_id === revision?.id && comment.path === path && comment.side === side && comment.line === line).map(comment =>
            <article className="pull-line-comment" key={comment.id}>
              <strong>{memberName(comment.author)} · {t(`pulls:files.${side}`)} {line}</strong>
              <p>{comment.body}</p>
              <PullRequestConversationResolution comment={comment} memberName={memberName} canWrite={canWrite}
                organizationID={organization.id} pullNumber={pullNumber} onUpdate={onUpdate} />
            </article>)}
          {anchor?.path === path && anchor.side === side && anchor.line === line &&
            <form className="pull-inline-composer" onSubmit={submit}>
              <h3>{path} · {t(`pulls:files.${side}`)} {line}</h3>
              <TextArea ref={composer} label={t("pulls:conversation.writeComment")} placeholder={t("pulls:conversation.commentPlaceholder")} value={body} maxLength={10000} onChange={event => setBody(event.target.value)}/>
              {error && <p role="alert">{error}</p>}
              <div className="org-actions">
                <Button disabled={saving || !body.trim()} type="submit">{t("pulls:conversation.submitComment")}</Button>
                <Button disabled={saving} onClick={closeComposer}>{t("common:actions.cancel")}</Button>
              </div>
            </form>}
        </>}/>}
    </div>
  </div>;
}
