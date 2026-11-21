import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, TextArea, Input } from "../../shared/ui";
import type { Issue } from "../../shared/api/issues";
import "./repositories.css";

interface IssueFormProps {
  mode: "create" | "edit";
  issue?: Issue;
  onSubmit: (data: { title: string; body: string }) => Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

export function IssueForm({ mode, issue, onSubmit, onCancel, busy = false }: IssueFormProps) {
  const { t } = useTranslation("repositories");

  const [title, setTitle] = useState(issue?.title || "");
  const [body, setBody] = useState(issue?.body || "");
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (!title.trim()) {
      setError(t("issues.form.titleRequired"));
      return;
    }

    try {
      await onSubmit({ title: title.trim(), body: body.trim() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <form className="issue-form" onSubmit={handleSubmit}>
      {error && (
        <div className="org-error" role="alert">
          {error}
        </div>
      )}

      <div className="issue-form-field">
        <label htmlFor="issue-title">
          {t("issues.form.title")} <span className="required">*</span>
        </label>
        <Input
          id="issue-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("issues.form.titlePlaceholder")}
          required
          disabled={busy}
          maxLength={500}
        />
      </div>

      <div className="issue-form-field">
        <label htmlFor="issue-body">{t("issues.form.body")}</label>
        <TextArea
          id="issue-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("issues.form.bodyPlaceholder")}
          disabled={busy}
          rows={10}
          maxLength={65536}
        />
        <small className="issue-form-hint">{t("issues.form.markdownSupported")}</small>
      </div>

      <div className="issue-form-actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy
            ? t("common:components.loading")
            : mode === "create"
              ? t("issues.form.createIssue")
              : t("issues.form.updateIssue")}
        </Button>
      </div>
    </form>
  );
}
