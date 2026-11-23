import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button, Input, Modal, TextArea } from "../../shared/ui";
import { APIError, translateError } from "../../shared/api/errors";
import { issuesAPI } from "../../shared/api/issues";
import type { issueConversationAPI, IssueArtifact, IssueRelationships } from "../../shared/api/issue-conversation";
import { issueDetailPath } from "../../shared/routing";
import type { IssueContext } from "./IssueConversation";

type Dialog = { kind: "create" | "existing" | "unlink" | "artifact"; number?: number; artifact?: IssueArtifact };

export function IssueDetailLinks({ api, context, issueNumber, canEdit, children }: {
  api: ReturnType<typeof issueConversationAPI>;
  context: IssueContext;
  issueNumber: number;
  canEdit: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation("repositories");
  const [relations, setRelations] = useState<IssueRelationships>();
  const [artifacts, setArtifacts] = useState<IssueArtifact[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog>();
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingArtifact = useRef<{ id: string; file: File }>(undefined);
  const [file, setFile] = useState<File>();

  const refresh = useCallback(async () => {
    const [links, files] = await Promise.allSettled([api.relationships(), api.artifacts()]);
    if (links.status === "fulfilled") setRelations(links.value);
    if (files.status === "fulfilled") setArtifacts(files.value ?? []);
    setLoadFailed(links.status === "rejected" || files.status === "rejected");
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = (action: Dialog) => {
    setError("");
    setTitle("");
    setBody("");
    setNumber("");
    setFile(undefined);
    setDialog(action);
  };
  const submit = async () => {
    if (!dialog || busy) return;
    setBusy(true);
    setError("");
    try {
      switch (dialog.kind) {
        case "create":
          await issuesAPI.create(context.organizationID, { repository: context.repository, title, body, parent_number: issueNumber });
          break;
        case "existing":
          await api.setParent(Number(number), issueNumber);
          break;
        case "unlink":
          if (dialog.number) await api.setParent(dialog.number);
          break;
        case "artifact":
          if (dialog.artifact) {
            await api.setArtifact(dialog.artifact.id, false);
          } else if (file) {
            if (pendingArtifact.current?.file !== file) {
              const uploaded = await issuesAPI.uploadAttachment(context.organizationID, context.repository, file);
              pendingArtifact.current = { id: uploaded.id, file };
            }
            await api.setArtifact(pendingArtifact.current.id, true);
            pendingArtifact.current = undefined;
          }
          break;
      }
      setDialog(undefined);
      await refresh();
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 404) pendingArtifact.current = undefined;
      setError(cause instanceof APIError && cause.status === 413 && file
        ? t("issues.composer.attachmentTooLarge", { name: file.name })
        : translateError(cause, t, "issues.detail.linksFailed"));
    } finally { setBusy(false); }
  };
  const dialogTitle = !dialog ? "" : t(`issues.detail.${dialog.artifact ? "removeArtifact" : dialog.kind === "artifact" ? "addArtifact" : dialog.kind === "create" ? "createChild" : dialog.kind === "existing" ? "addChild" : "unlinkChild"}`);
  const childNumber = Number(number);
  const validNumber = /^[1-9]\d*$/.test(number) && childNumber <= 2147483647;
  const issueLink = (entry: NonNullable<IssueRelationships["parent"]>) =>
    <Link to={issueDetailPath(context.handle, context.repository, entry.number)}>#{entry.number} {entry.title}</Link>;

  return <>
    <footer className="issue-detail__post-footer">
      {canEdit && <>
        <Button variant="secondary" size="small" onClick={() => open({ kind: "create" })}>{t("issues.detail.createChild")}</Button>
        <Button variant="secondary" size="small" onClick={() => open({ kind: "existing" })}>{t("issues.detail.addChild")}</Button>
        <Button variant="secondary" size="small" onClick={() => open({ kind: "artifact" })}>{t("issues.detail.addArtifact")}</Button>
      </>}
      {children}
    </footer>
    {loadFailed && <p className="issue-detail__body" role="alert">{t("issues.detail.linksFailed")} <Button size="small" variant="ghost" onClick={() => void refresh()}>{t("issues.composer.retry")}</Button></p>}
    {relations && (relations.parent || relations.children.length > 0) && <section className="issue-detail__linked" aria-label={t("issues.detail.subIssues")}>
      {relations.parent && <p>{t("issues.detail.parentIssue")} {issueLink(relations.parent)}
        {canEdit && <Button size="small" variant="ghost" onClick={() => open({ kind: "unlink", number: issueNumber })}>{t("issues.detail.unlinkChild")}</Button>}
      </p>}
      {relations.children.length > 0 && <><h3>{t("issues.detail.subIssues")}</h3><ul>
        {relations.children.map((entry) => <li key={entry.id}>{issueLink(entry)} {canEdit && <Button size="small" variant="ghost" onClick={() => open({ kind: "unlink", number: entry.number })}>{t("issues.detail.unlinkChild")}</Button>}</li>)}
      </ul></>}
    </section>}
    {!!artifacts?.length && <section className="issue-detail__linked" aria-label={t("issues.detail.artifacts")}>
      <h3>{t("issues.detail.artifacts")}</h3><ul>{artifacts.map((entry) => <li key={entry.id}>
        <a href={entry.url} download={entry.name}>{entry.name}</a>{" "}
        {canEdit && <Button size="small" variant="ghost" onClick={() => open({ kind: "artifact", artifact: entry })}>{t("issues.detail.removeArtifact")}</Button>}
      </li>)}</ul>
    </section>}
    {dialog && <Modal open title={dialogTitle} onCancel={() => setDialog(undefined)} confirmLoading={busy} onOk={submit} okText={dialogTitle}
      okDisabled={dialog.kind === "create" && !title.trim() || dialog.kind === "existing" && !validNumber || dialog.kind === "artifact" && !dialog.artifact && !file}>
      {error && <p role="alert">{error}</p>}
      {dialog.kind === "create" && <>
        <Input label={t("issues.form.title")} maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
        <TextArea aria-label={t("issues.form.body")} maxLength={65536} value={body} onChange={(event) => setBody(event.target.value)} disabled={busy} />
      </>}
      {dialog.kind === "existing" && <Input label={t("issues.detail.childNumber")} inputMode="numeric" maxLength={10} value={number} onChange={(event) => setNumber(event.target.value)} disabled={busy} />}
      {dialog.kind === "unlink" && <p>{t("issues.detail.unlinkPrompt", { number: dialog.number })}</p>}
      {dialog.kind === "artifact" && (dialog.artifact ? <p>{t("issues.detail.removeArtifactPrompt", { name: dialog.artifact.name })}</p>
        : <Input type="file" aria-label={t("issues.detail.selectArtifact")} disabled={busy} onChange={(event) => {
          const selected = event.currentTarget.files?.[0];
          setFile(selected);
          setError("");
        }} />)}
    </Modal>}
  </>;
}
