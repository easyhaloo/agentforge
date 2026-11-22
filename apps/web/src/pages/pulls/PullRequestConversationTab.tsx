import { useState, type FormEvent } from "react";
import { Activity, GitCommitHorizontal, GitMerge, ShieldCheck } from "lucide-react";
import { AccountAvatar } from "../../shared/ui/components/AccountAvatar";
import { useDateFormatting } from "../../shared/i18n/format";
import { auditEntryLabel } from "../changesets/changeset-status";
import { useTranslation } from "react-i18next";
import { changesetAPI, type OrganizationSummary, type StoredChangeset } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { Button, TextArea } from "../../shared/ui";

type Props = {
  organization: OrganizationSummary;
  changeset: StoredChangeset;
  pullNumber: string;
  onUpdate: (changeset: StoredChangeset) => void;
  memberName: (id: string) => string;
};

export function PullRequestConversationTab({ organization, changeset, pullNumber, onUpdate, memberName }: Props) {
  const { t } = useTranslation(["pulls", "changesets"]);
  const { formatDateTime } = useDateFormatting();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const pr = changeset.changeset.pull_request!;
  const activeRevisionId = changeset.changeset.revisions[changeset.changeset.revisions.length - 1]?.id;
  const items = [
    ...pr.comments.map(comment => ({ kind: "comment" as const, at: comment.created_at, comment })),
    ...changeset.changeset.audit.filter(event => event.operation !== "pull_request.comment_added")
      .map(event => ({ kind: "event" as const, at: event.at, event })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!comment.trim()) return;
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
          </article>
        </li>;
      })}
    </ol>

    {organization.role !== "viewer" && <form className="pull-comment-form card" onSubmit={submit}>
      <h3>{t("pulls:conversation.writeComment")}</h3>
      <TextArea
        value={comment}
        onChange={e => setComment(e.target.value)}
        label={t("pulls:conversation.writeComment")}
        maxLength={10000}
        placeholder={t("pulls:conversation.commentPlaceholder")}
        rows={4}
      />
      {error && <div className="form-error" role="alert">{error}</div>}
      <Button type="submit" className="button primary" disabled={submitting || !comment.trim()}>
        {submitting ? t("pulls:conversation.submitting") : t("pulls:conversation.submitComment")}
      </Button>
    </form>}
  </div>;
}
