import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { APIError, translateError } from "../../shared/api/errors";
import type { IssueGitHubSource, issueConversationAPI } from "../../shared/api/issue-conversation";
import { Button, Input, Modal } from "../../shared/ui";

export function IssueGitHubSourceActions({ api, value, onChange, editable }: {
  api: ReturnType<typeof issueConversationAPI>;
  value?: IssueGitHubSource | null;
  onChange: (source: IssueGitHubSource | null) => void;
  editable: boolean;
}) {
  const { t } = useTranslation("repositories");
  const [draft, setDraft] = useState<{ url: string; expected: string }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const begin = async () => {
    setError("");
    setLoading(true);
    try {
      const current = await api.githubSource();
      onChange(current);
      setDraft({ url: current?.url ?? "", expected: current?.fetched_at ?? "" });
    } catch (cause) {
      setError(translateError(cause, t, "issues.detail.githubFailed"));
    } finally {
      setLoading(false);
    }
  };
  const submit = async () => {
    if (!draft || busy) return;
    setError("");
    setBusy(true);
    try {
      onChange(await api.setGitHubSource(draft.url, draft.expected));
      setDraft(undefined);
    } catch (cause) {
      setError(cause instanceof APIError && cause.status === 404
        ? t("issues.detail.githubNotFound") : translateError(cause, t, "issues.detail.githubFailed"));
    } finally {
      setBusy(false);
    }
  };
  if (!editable && !value) return null;
  const editLabel = t(value ? "issues.detail.githubManage" : "issues.detail.githubLink");
  return <div className="issue-sidebar-section">
    {value && <p><a href={value.url} target="_blank" rel="noreferrer">{t("issues.detail.githubOpen")} <ExternalLink size={12} aria-hidden="true" /></a></p>}
    {editable && <Button variant="ghost" size="small" disabled={loading} onClick={() => void begin()}>{editLabel}</Button>}
    {!draft && error && <p role="alert">{error}</p>}
    {draft && <Modal open title={editLabel} okText={t(draft.url.trim() ? "issues.detail.githubSync" : "issues.detail.githubUnlink")}
      okDisabled={!draft.url.trim() && !value} confirmLoading={busy} onCancel={() => setDraft(undefined)} onOk={submit}>
      <div className="issue-detail__sidebar-editor">
        <Input label={t("issues.detail.githubURL")} value={draft.url} maxLength={200} disabled={busy}
          onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
        <p>{t("issues.detail.githubHint")}</p>
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>}
  </div>;
}
