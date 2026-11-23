import { useEffect, useState, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Ellipsis, Smile } from "lucide-react";
import { Button, Popover, TextArea } from "../../shared/ui";
import { translateError } from "../../shared/api/errors";
import { type issueConversationAPI, type IssueReaction, reactionEmoji, type ReactionContent } from "../../shared/api/issue-conversation";
import { IssueMarkdown } from "./IssueMarkdown";

export type IssueContext = { organizationID: string; repository: string; handle: string };

export function IssueTextEditor({ context, value, onChange, label, fieldRef, preview, setPreview, busy }: {
  context: IssueContext; value: string; onChange: (value: string) => void; label: string;
  fieldRef?: Ref<HTMLTextAreaElement>; preview: boolean; setPreview: (value: boolean) => void; busy: boolean;
}) {
  const { t } = useTranslation("repositories");
  return <div className="issue-conversation-editor">
    <div className="issue-conversation-editor__tabs">
      <Button type="button" variant="ghost" size="small" aria-pressed={!preview} onClick={() => setPreview(false)}>{t("issues.composer.write")}</Button>
      <Button type="button" variant="ghost" size="small" aria-pressed={preview} onClick={() => setPreview(true)}>{t("issues.composer.preview")}</Button>
    </div>
    {preview ? <div className="issue-detail__body">{value.trim() ? <IssueMarkdown {...context} content={value} /> : t("issues.detail.noPreview")}</div>
      : <TextArea ref={fieldRef} aria-label={label} rows={6} maxLength={65536} value={value} onChange={(event) => onChange(event.target.value)} disabled={busy} />}
  </div>;
}

export function IssuePostMenu({ copyLink, copyMarkdown, quote, canQuote, children }: {
  copyLink: () => void; copyMarkdown: () => void; quote: () => void; canQuote: boolean; children?: ReactNode;
}) {
  const { t } = useTranslation("repositories");
  const [menuVersion, setMenuVersion] = useState(0);
  return <Popover key={menuVersion} trigger={<><Ellipsis size={19} aria-hidden="true" /><span className="issue-detail__sr-only">{t("issues.detail.postOptions")}</span></>} ariaLabel={t("issues.detail.postOptions")}>
    <div className="issue-detail-menu" onClick={(event) => {
      if (event.target instanceof Element && event.target.closest("button")) setMenuVersion((version) => version + 1);
    }}>
      <Button variant="ghost" onClick={copyLink}>{t("issues.detail.copyLink")}</Button>
      <Button variant="ghost" onClick={copyMarkdown}>{t("issues.detail.copyMarkdown")}</Button>
      {canQuote && <Button variant="ghost" onClick={quote}>{t("issues.detail.quoteReply")}</Button>}
      {children}
    </div>
  </Popover>;
}

const reactionTypes = Object.keys(reactionEmoji) as ReactionContent[];

export function IssueReactions({ api, commentID, user, canReact }: {
  api: ReturnType<typeof issueConversationAPI>; commentID?: string; user: string; canReact: boolean;
}) {
  const { t } = useTranslation("repositories");
  const [items, setItems] = useState<IssueReaction[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api.reactions(commentID).then((value) => { if (active) setItems(value); }).catch((cause: unknown) => {
      if (active) setError(translateError(cause, t, "repositories:issues.detail.reactionsFailed"));
    });
    return () => { active = false; };
  }, [api, commentID, t, attempt]);

  const toggle = async (content: ReactionContent) => {
    if (!canReact || busy || !items) return;
    const mine = items.find((reaction) => reaction.user_id === user && reaction.content === content);
    setBusy(true);
    setError("");
    try {
      if (mine) await api.unreact(mine.id, commentID);
      else await api.react(content, commentID);
      setItems(await api.reactions(commentID));
    } catch (cause) {
      setError(translateError(cause, t, "repositories:issues.detail.reactionsFailed"));
      setAttempt((current) => current + 1);
    } finally {
      setBusy(false);
    }
  };

  return <div className="issue-reactions">
    {canReact && items && <Popover placement="top" trigger={<><Smile size={16} aria-hidden="true" /><span className="issue-detail__sr-only">{t("issues.detail.addReaction")}</span></>} ariaLabel={t("issues.detail.addReaction")}>
      <div className="issue-reactions__picker">{reactionTypes.map((type) => <Button key={type} type="button" size="small" variant="ghost"
        aria-label={t(`issues.detail.reaction.${type}`)} disabled={busy} onClick={() => void toggle(type)}>{reactionEmoji[type]}</Button>)}</div>
    </Popover>}
    {reactionTypes.map((type) => {
      const reactions = items?.filter(({ content }) => content === type) ?? [];
      if (!reactions.length) return null;
      return <Button size="small" variant="secondary" key={type} aria-pressed={reactions.some(({ user_id }) => user_id === user)}
        aria-label={`${t(`issues.detail.reaction.${type}`)} (${reactions.length})`} disabled={busy || !canReact} onClick={() => void toggle(type)}>{reactionEmoji[type]} {reactions.length}</Button>;
    })}
    {error && <span role="alert">{error} <Button size="small" variant="ghost" onClick={() => { setError(""); setAttempt((current) => current + 1); }}>{t("issues.composer.retry")}</Button></span>}
  </div>;
}
