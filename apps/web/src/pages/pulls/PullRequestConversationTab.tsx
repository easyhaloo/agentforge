import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Activity, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, ShieldCheck } from "lucide-react";
import { AccountAvatar } from "../../shared/ui/components/AccountAvatar";
import { useDateFormatting } from "../../shared/i18n/format";
import { auditEntryLabel } from "../changesets/changeset-status";
import { useTranslation } from "react-i18next";
import { changesetAPI, type OrganizationSummary, type StoredChangeset } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { Button, TextArea } from "../../shared/ui";
import { PullRequestConversationResolution } from "./PullRequestConversationResolution";

type Props = {
  organization: OrganizationSummary;
  changeset: StoredChangeset;
  pullNumber: string;
  onUpdate: (changeset: StoredChangeset) => void;
  memberName: (id: string) => string;
  lifecycleAction?: "close" | "reopen";
  lifecycleError: string;
  onLifecycleAction: (action: "close" | "reopen") => Promise<void>;
  actionBusy: boolean;
  children: ReactNode;
};

export function PullRequestConversationTab({
  organization, changeset, pullNumber, onUpdate, memberName,
  lifecycleAction, lifecycleError, onLifecycleAction, actionBusy, children,
}: Props) {
  const { t } = useTranslation(["pulls", "changesets"]);
  const { formatDateTime } = useDateFormatting();
  const composerTitle = useId();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const LifecycleIcon = lifecycleAction === "close" ? GitPullRequestClosed : GitPullRequest;
  const pr = changeset.changeset.pull_request!;
  const activeRevisionId = changeset.changeset.revisions[changeset.changeset.revisions.length - 1]?.id;
  const items = [
    ...pr.comments.map(comment => ({ kind: "comment" as const, at: comment.created_at, comment })),
    ...changeset.changeset.audit.filter(event => event.operation !== "pull_request.comment_added" && !event.operation.startsWith("pull_request.conversation_"))
      .map(event => ({ kind: "event" as const, at: event.at, event })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || actionBusy || !comment.trim()) return;
    setSubmitting(true); setError("");
    try {
      const result = await changesetAPI.addPullRequestComment(organization.id, pullNumber, comment.trim());
      onUpdate(result);
      setComment("");
    } catch (cause) { setError(translateError(cause, t, "pulls:conversation.commentFailed")); }
    finally { setSubmitting(false); }
  };

  return <div className="pull-conversation-tab">
    <ol className="pull-timeline" aria-label={t("pulls:conversation.title")}>
      <li className="pull-timeline-entry">
        <div className="pull-timeline-marker"><AccountAvatar userId={changeset.changeset.created_by} size={32}/></div>
        <article className="comment-item">
          <div className="comment-header">
            <strong>{memberName(changeset.changeset.created_by)}</strong>
            <span className="comment-date">{t("pulls:conversation.openedOn", { date: formatDateTime(changeset.created_at) })}</span>
          </div>
          <div className="comment-body">{pr.description || t("pulls:conversation.noDescription")}</div>
        </article>
      </li>
      {items.map(item => {
        if (item.kind === "event") {
          const event = item.event;
          const Icon = event.operation.startsWith("revision.") ? GitCommitHorizontal : event.operation.startsWith("merge.") ? GitMerge :
            /^(evaluation|evidence|review)\./.test(event.operation) ? ShieldCheck : Activity;
          return <li key={`event-${event.sequence}`} className="pull-timeline-entry pull-activity-event">
            <span className="pull-timeline-marker pull-event-icon"><Icon size={15} aria-hidden="true"/></span>
            <div>
              <strong>{auditEntryLabel(event.operation, event.outcome, t)}</strong>{" "}
              <span>{t("changesets:detail.auditEntry", { actor: memberName(event.actor), at: formatDateTime(event.at) })}</span>
            </div>
          </li>;
        }
        const c = item.comment;
        const isStale = c.revision_id && c.revision_id !== activeRevisionId;
        return <li key={c.id} className="pull-timeline-entry">
          <div className="pull-timeline-marker"><AccountAvatar userId={c.author} size={32}/></div>
          <article className="comment-item">
            <div className="comment-header">
              <strong>{memberName(c.author)}</strong>
              <span className="comment-date">{t("pulls:conversation.commentedOn", { date: formatDateTime(c.created_at) })}</span>
              {isStale && <span className="comment-stale-badge">{t("pulls:conversation.staleComment")}</span>}
            </div>
            <div className="comment-body">{c.body}</div>
            {c.revision_id && <div className="comment-body">
              <PullRequestConversationResolution comment={c} memberName={memberName}
                canWrite={organization.role !== "viewer"} organizationID={organization.id}
                pullNumber={pullNumber} onUpdate={onUpdate} />
            </div>}
          </article>
        </li>;
      })}
    </ol>

    {children}

    {organization.role !== "viewer" && <form className="pull-comment-form" onSubmit={submit} aria-labelledby={composerTitle}>
      <h3 id={composerTitle}>{t("pulls:conversation.writeComment")}</h3>
      <div className="card pull-comment-editor">
        <TextArea
          value={comment}
          onChange={e => setComment(e.target.value)}
          aria-labelledby={composerTitle}
          maxLength={10000}
          placeholder={t("pulls:conversation.commentPlaceholder")}
          rows={4}
        />
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {lifecycleError && <div className="form-error" role="alert">{lifecycleError}</div>}
      <div className="pull-comment-actions">
        {lifecycleAction && <Button
          type="button"
          className={lifecycleAction === "close" ? "pull-comment-close" : undefined}
          onClick={() => { void onLifecycleAction(lifecycleAction); }}
          disabled={actionBusy || submitting}
        >
          <LifecycleIcon size={16} aria-hidden="true"/> {t(`pulls:actions.${lifecycleAction}`)}
        </Button>}
        <Button type="submit" variant="primary" disabled={actionBusy || submitting || !comment.trim()}>
          {submitting ? t("pulls:conversation.submitting") : t("pulls:conversation.submitComment")}
        </Button>
      </div>
    </form>}
  </div>;
}
