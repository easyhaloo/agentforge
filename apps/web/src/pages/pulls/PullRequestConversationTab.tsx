import { useState, type FormEvent } from "react";
import { MessageSquare } from "lucide-react";
import { useDateFormatting } from "../../shared/i18n/format";
import { auditEntryLabel } from "../changesets/changeset-status";
import { useTranslation } from "react-i18next";
import { changesetAPI, type OrganizationSummary, type StoredChangeset, type PullRequestComment } from "../../shared/api/identity";
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
    <div className="pull-description card">
      <h3>{t("pulls:create.descriptionLabel")}</h3>
      {pr.description ? (
        <div className="pull-description-text">{pr.description}</div>
      ) : (
        <p className="text-muted">{t("pulls:conversation.noDescription")}</p>
      )}
    </div>

    <div className="pull-comments card">
      <h3>{t("pulls:conversation.title")}</h3>
      {items.length === 0 ? (
        <p className="text-muted">{t("pulls:conversation.noComments")}</p>
      ) : (
        <div className="comment-list">
          {items.map(item => {
            if (item.kind === "event") {
              const event = item.event;
              return <div key={`event-${event.sequence}`} className="pull-activity-event">
                <strong>{auditEntryLabel(event.operation, event.outcome, t)}</strong>
                <span>{t("changesets:detail.auditEntry", { actor: memberName(event.actor), at: formatDateTime(event.at) })}</span>
              </div>;
            }
            const c = item.comment;
            const isStale = c.revision_id && c.revision_id !== activeRevisionId;
            return <div key={c.id} className={`comment-item ${isStale ? "comment-stale" : ""}`}>
              <div className="comment-header">
                <MessageSquare size={14}/>
                <span className="comment-author">{memberName(c.author)}</span>
                <span className="comment-date">{t("pulls:conversation.commentedOn", { date: formatDateTime(c.created_at) })}</span>
                {isStale && <span className="comment-stale-badge">{t("pulls:conversation.staleComment")}</span>}
              </div>
              <div className="comment-body">{c.body}</div>
            </div>;
          })}
        </div>
      )}
    </div>

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
