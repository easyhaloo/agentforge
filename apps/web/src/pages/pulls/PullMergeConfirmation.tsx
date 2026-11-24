import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { changesetAPI, type PullRequestMergeInput, type PullRequestMergeMessage, type PullRequestMergeMethod } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { Button, Input, TextArea } from "../../shared/ui";

type PullMergeConfirmationProps = {
  organizationID: string;
  pullNumber: string;
  revisionID: string;
  method?: PullRequestMergeMethod;
  source: string;
  base: string;
  disabled: boolean;
  onConfirm: (message?: PullRequestMergeInput) => void;
  onCancel: () => void;
  onRefresh: () => void;
};

export function PullMergeConfirmation({
  organizationID, pullNumber, revisionID, method, source, base, disabled, onConfirm, onCancel, onRefresh,
}: PullMergeConfirmationProps) {
  const { t } = useTranslation(["pulls", "common"]);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PullRequestMergeMessage>();
  const [draft, setDraft] = useState<Pick<PullRequestMergeMessage, "title" | "body">>();
  const [loadError, setLoadError] = useState("");
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const confirmText = t(`pulls:actions.confirmMethods.${method ?? "merge"}`);
  const editable = method === "merge" || method === "squash";
  const message = draft ?? preview;
  const edited = draft && (draft.title !== preview?.title || draft.body !== preview?.body);
  const loading = editable && !preview && !loadError;
  const canConfirm = !disabled && (!editable || (preview && (!edited || draft.title.trim())));
  const canFocusTitle = Boolean(preview) && !disabled;

  useEffect(() => {
    if (method !== "merge" && method !== "squash") return;
    const controller = new AbortController();
    void changesetAPI.getMergeMessage(organizationID, pullNumber, method, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.revision_id !== revisionID) {
        setStale(true);
        setLoadError(t("pulls:errors.comparisonChanged"));
      } else setPreview(result);
    }).catch(cause => {
      if (!controller.signal.aborted) setLoadError(translateError(cause, t, "pulls:actions.loadMergeMessageFailed"));
    });
    return () => controller.abort();
  }, [organizationID, pullNumber, method, revisionID, attempt, t]);

  useEffect(() => {
    formRef.current?.focus();
  }, []);

  useEffect(() => {
    if (canFocusTitle && formRef.current?.ownerDocument.activeElement === formRef.current) {
      titleRef.current?.focus();
    }
  }, [canFocusTitle]);

  return (
    <form
      ref={formRef}
      className="pull-merge-confirmation"
      aria-label={confirmText}
      tabIndex={-1}
      onSubmit={event => {
        event.preventDefault();
        if (!canConfirm) return;
        if (!preview) onConfirm();
        else onConfirm({ revision_id: preview.revision_id, base_sha: preview.base_sha, ...(edited ? draft : {}) });
      }}
      onKeyDown={event => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing && !disabled) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      {!editable && <p>{t("pulls:actions.confirmMerge", { source, base })}</p>}
      {loading && <p role="status">{t("pulls:actions.loadingMergeMessage")}</p>}
      {loadError && <>
        <p role="alert">{loadError}</p>
        <Button onClick={() => {
          if (stale) onRefresh();
          else {
            formRef.current?.focus();
            setLoadError("");
            setAttempt(value => value + 1);
          }
        }} disabled={disabled}>{t("pulls:actions.retry")}</Button>
      </>}
      {message && <>
        <Input
          ref={titleRef}
          label={t("pulls:actions.commitMessage")}
          value={message.title}
          onChange={event => setDraft({ title: event.target.value, body: message.body })}
          maxLength={500}
          readOnly={disabled}
        />
        <TextArea
          label={t("pulls:actions.extendedDescription")}
          value={message.body}
          onChange={event => setDraft({ title: message.title, body: event.target.value })}
          maxLength={65536}
          readOnly={disabled}
        />
        <p>{t("pulls:actions.mergeCommitAuthor")}</p>
      </>}
      <div className="pull-merge-actions">
        <Button type="submit" variant="primary" disabled={!canConfirm}>{confirmText}</Button>
        <Button onClick={onCancel} disabled={disabled}>{t("common:actions.cancel")}</Button>
      </div>
    </form>
  );
}
