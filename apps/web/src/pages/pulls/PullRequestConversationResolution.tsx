import { useState } from "react";
import { useTranslation } from "react-i18next";
import { changesetAPI, type PullRequestComment, type StoredChangeset } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { useDateFormatting } from "../../shared/i18n/format";
import { Button } from "../../shared/ui";

type Props = {
  comment: PullRequestComment;
  memberName: (id: string) => string;
  canWrite: boolean;
  organizationID: string;
  pullNumber: string;
  onUpdate: (changeset: StoredChangeset) => void;
};

export function PullRequestConversationResolution({ comment, memberName, canWrite, organizationID, pullNumber, onUpdate }: Props) {
  const { t } = useTranslation("pulls");
  const { formatDateTime } = useDateFormatting();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { resolved_at: resolvedAt, resolved_by: resolvedBy } = comment;
  const resolved = Boolean(resolvedAt && resolvedBy);

  async function toggleResolution() {
    setSaving(true);
    setError("");
    try {
      onUpdate(await changesetAPI.setPullRequestCommentResolution(organizationID, pullNumber, comment.id, !resolved));
    } catch (cause) {
      setError(translateError(cause, t, "pulls:conversation.resolutionFailed"));
    } finally {
      setSaving(false);
    }
  }

  return <div className="org-actions">
    <span className="comment-date">{resolvedAt && resolvedBy
      ? t("conversation.threadResolved", { actor: memberName(resolvedBy), date: formatDateTime(resolvedAt) })
      : t("conversation.threadUnresolved")}</span>
    {canWrite && <Button variant="ghost" disabled={saving} onClick={() => void toggleResolution()}>
      {t(resolved ? "conversation.reopenThread" : "conversation.resolveThread")}
    </Button>}
    {error && <span role="alert">{error}</span>}
  </div>;
}
