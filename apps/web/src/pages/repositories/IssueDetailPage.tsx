import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowRight, CheckCircle2, Copy, GitBranch, Lock, MessageSquare, Pencil, Settings } from "lucide-react";
import { Button, Input, Modal, Select, TextArea } from "../../shared/ui";
import { organizationAPI, repositoryAPI, type OrganizationSummary } from "../../shared/api/identity";
import { issuesAPI, type Issue, type IssueStateReason, type IssueUpdate } from "../../shared/api/issues";
import { translateError } from "../../shared/api/errors";
import { useDateFormatting } from "../../shared/i18n/format";
import { changesetPath, issueDetailPath, issueTemplatePath, organizationHandle, projectPath, repositoryPath } from "../../shared/routing";
import { IssueDetailFields, IssueDevelopment } from "./IssueDetailSidebar";
import { IssueDetailLinks } from "./IssueDetailLinks";
import { IssueGitHubSourceActions } from "./IssueGitHubSource";
import { IssueCreateMetadata, type IssueMetadata } from "./IssueCreateMetadata";
import { IssueMarkdown } from "./IssueMarkdown";
import { IssuePostMenu, IssueReactions, IssueTextEditor } from "./IssueConversation";
import { issueConversationAPI, lockReasons, type IssueComment, type IssueEvent, type IssueGitHubSource, type LockReason, reportReasons, type ReportReason } from "../../shared/api/issue-conversation";
import "./repositories.css";

interface IssueDetailPageProps {
  organization: OrganizationSummary;
  repository: string;
  issueNumber: number;
  currentUser: string;
  onNotify: (message: string) => void;
}

export function IssueDetailPage({ organization, repository, issueNumber, currentUser, onNotify }: IssueDetailPageProps) {
  const { t } = useTranslation("repositories");
  const { formatDateTime } = useDateFormatting();
  const handle = organizationHandle(organization);
  const navigate = useNavigate();
  const { hash } = useLocation();

  const [issue, setIssue] = useState<Issue | null>(null);
  const [transfer, setTransfer] = useState<{ choices: string[]; target: string; version: string; loading: boolean; error?: string }>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const api = useMemo(() => issueConversationAPI(organization.id, repository, issueNumber), [organization.id, repository, issueNumber]);
  const moderator = organization.role === "owner" || organization.role === "admin";
  const canWrite = organization.role !== "viewer";
  const canEdit = canWrite && (moderator || issue?.created_by === currentUser);
  const canComment = canWrite && (!issue?.locked || moderator);
  const context = { organizationID: organization.id, handle, repository };
  const [comments, setComments] = useState<IssueComment[] | null>(null);
  const [events, setEvents] = useState<IssueEvent[]>([]);
  const [githubSource, setGitHubSource] = useState<IssueGitHubSource | null>();
  const [activityError, setActivityError] = useState("");
  const [subscribed, setSubscribed] = useState<boolean>();
  const [subscriptionFailed, setSubscriptionFailed] = useState(false);
  const [edit, setEdit] = useState<{ target: "title" | "body" | IssueComment; value: string; revision: string }>();
  const [dialogError, setDialogError] = useState("");
  const [editPreview, setEditPreview] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentPreview, setCommentPreview] = useState(false);
  const commentField = useRef<HTMLTextAreaElement>(null);
  const quoteFocus = useRef(false);
  const [commentError, setCommentError] = useState("");
  const [deleting, setDeleting] = useState<IssueComment>();
  const [lockDialog, setLockDialog] = useState(false);
  const [lockReason, setLockReason] = useState<LockReason>(lockReasons[0]);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [metadata, setMetadata] = useState<{ field: keyof IssueMetadata; draft: IssueMetadata; version: string }>();
  const [report, setReport] = useState<{ commentId?: string; reason: ReportReason; details: string }>();
  const [memberNames, setMemberNames] = useState<Map<string, string>>(new Map());
  const [closeReason, setCloseReason] = useState<IssueStateReason>("completed");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await issuesAPI.get(organization.id, issueNumber, repository);
      if (result.repository !== repository || result.number !== issueNumber) {
        void navigate(`${issueDetailPath(handle, result.repository, result.number)}${hash}`, { replace: true });
        return;
      }
      setIssue(result);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:issues.detail.loadFailed"));
      setIssue(null);
    } finally {
      setLoading(false);
    }
  }, [organization.id, issueNumber, repository, handle, hash, navigate, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    setGitHubSource(undefined);
    void api.githubSource().then((source) => {
      if (active) setGitHubSource(source);
    }).catch(() => {});
    return () => { active = false; };
  }, [api]);

  const refreshActivity = useCallback(async () => {
    setActivityError("");
    const [posts, timeline] = await Promise.allSettled([api.comments(), api.timeline()]);
    if (posts.status === "fulfilled") setComments(posts.value);
    if (timeline.status === "fulfilled") setEvents(timeline.value);
    if (posts.status === "rejected" || timeline.status === "rejected") setActivityError(t("issues.detail.activityFailed"));
  }, [api, t]);

  const refreshSubscription = useCallback(async () => {
    setSubscriptionFailed(false);
    try { setSubscribed(await api.subscribe()); } catch { setSubscriptionFailed(true); }
  }, [api]);

  useEffect(() => {
    if (!issue?.id) return;
    void refreshActivity();
    void refreshSubscription();
    // Content mutations refresh activity explicitly to preserve drafts and avoid repeated fetches.
  }, [issue?.id, refreshActivity, refreshSubscription]);

  useEffect(() => {
    if (!moderator) return;
    let active = true;
    organizationAPI.members(organization.id).then(({ items }) => {
      if (active) setMemberNames(new Map(items.map(({ user_id, display_name }) => [user_id, display_name])));
    }).catch(() => {});
    return () => { active = false; };
  }, [moderator, organization.id]);

  const authorName = (id?: string) => id ? memberNames.get(id) || id : t("issues.detail.systemActor");
  const metadataLabels: Record<keyof IssueMetadata, string> = {
    assignees: t("issues.assignees"), label_ids: t("issues.labels"), issue_type: t("issues.type.label"),
    project_ids: t("issues.projects.title"), milestone_id: t("issues.milestone"),
  };
  const startMetadata = (field: keyof IssueMetadata) => {
    if (!issue) return;
    setDialogError("");
    setMetadata({ field, version: issue.updated_at, draft: {
      assignees: issue.assignees.map(({ user_id }) => user_id), label_ids: issue.labels.map(({ id }) => id),
      issue_type: issue.issue_type ?? "", milestone_id: issue.milestone_id ?? "", project_ids: issue.projects?.map(({ id }) => id) ?? [],
    } });
  };
  const saveMetadata = async (data: IssueUpdate, close?: () => void) => {
    if (!issue || busy) return;
    setBusy(true);
    setDialogError("");
    setError("");
    try {
      setIssue(await issuesAPI.update(organization.id, issueNumber, repository, data));
      close?.();
      void refreshActivity();
    } catch (cause) {
      const message = translateError(cause, t, "issues.detail.updateFailed");
      if (close) setDialogError(message);
      else setError(message);
    } finally { setBusy(false); }
  };
  const metadataHeading = (field: keyof IssueMetadata) => <div className="issue-sidebar-heading">
    <h3>{metadataLabels[field]}</h3>
    {moderator && <Button variant="ghost" size="small" aria-label={t("issues.detail.editMetadata", { field: metadataLabels[field] })}
      onClick={() => startMetadata(field)} disabled={busy}><Settings size={15} aria-hidden="true" /></Button>}
  </div>;
  const beginTransfer = async () => {
    if (!issue) return;
    setDialogError("");
    const draft = { choices: [], target: "", version: issue.updated_at, loading: true };
    setTransfer(draft);
    try {
      const { items } = await repositoryAPI.list(organization.id);
      const sourceIsPublic = items.some((entry) => entry.slug === repository && entry.visibility === "public");
      const choices = items.filter((entry) => entry.slug !== repository && (sourceIsPublic || entry.visibility !== "public")).map((entry) => entry.slug);
      setTransfer((current) => current === draft ? { ...draft, choices, loading: false } : current);
    } catch (cause) {
      const error = translateError(cause, t, "issues.detail.transferFailed");
      setTransfer((current) => current === draft ? { ...draft, loading: false, error } : current);
    }
  };
  const submitTransfer = async () => {
    if (!transfer?.target || busy) return;
    setBusy(true);
    setDialogError("");
    try {
      const moved = await api.transfer(transfer.target, transfer.version);
      void navigate(issueDetailPath(handle, moved.repository, moved.number), { replace: true });
    } catch (cause) {
      setDialogError(translateError(cause, t, "issues.detail.transferFailed"));
    } finally { setBusy(false); }
  };

  const startReport = (commentId?: string) => {
    setDialogError("");
    setReport({ commentId, reason: reportReasons[0], details: "" });
  };
  const submitReport = async () => {
    if (!report || busy) return;
    setBusy(true);
    setDialogError("");
    try {
      await api.report(report.reason, report.details, report.commentId);
      setReport(undefined);
      onNotify(t("issues.detail.reportSuccess"));
    } catch (cause) {
      setDialogError(translateError(cause, t, "issues.detail.reportFailed"));
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (quoteFocus.current && !commentPreview) {
      quoteFocus.current = false;
      const field = commentField.current;
      field?.focus();
      field?.setSelectionRange(field.value.length, field.value.length);
    }
  }, [commentDraft, commentPreview]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify(t("issues.detail.copied"));
    } catch { setError(t("issues.detail.copyFailed")); }
  };
  const linkFor = (anchor = "") => new URL(`${window.location.pathname}${anchor}`, window.location.origin).href;
  const quote = (text: string) => {
    if (!canComment) return;
    const quoted = text.split("\n").map((line) => `> ${line}`).join("\n");
    if (commentDraft.length + quoted.length + 4 > 65536) {
      setCommentError(t("issues.detail.quoteTooLong"));
      return;
    }
    quoteFocus.current = true;
    setCommentDraft((draft) => `${draft ? `${draft}\n\n` : ""}${quoted}\n\n`);
    setCommentPreview(false);
  };

  const startEdit = (target: "title" | "body" | IssueComment) => {
    if (!issue) return;
    setEdit({ target, value: typeof target === "string" ? issue[target] : target.body, revision: issue.updated_at });
    setDialogError("");
    setEditPreview(false);
  };
  const saveEdit = async () => {
    if (!edit || busy) return;
    const { target, value, revision } = edit;
    setBusy(true);
    setDialogError("");
    try {
      if (typeof target === "string") {
        const data: IssueUpdate = { [target]: value, expected_updated_at: revision };
        setIssue(await issuesAPI.update(organization.id, issueNumber, repository, data));
      } else {
        const saved = await api.update(target, value);
        setComments((items) => items?.map((entry) => entry.id === saved.id ? saved : entry) ?? [saved]);
      }
      setEdit(undefined);
      onNotify(t("issues.detail.updateSuccess"));
      void refreshActivity();
    } catch (cause) {
      setDialogError(translateError(cause, t, "repositories:issues.detail.updateFailed"));
    } finally { setBusy(false); }
  };

  const submitComment = async () => {
    if (!canComment || !commentDraft.trim() || busy) return;
    setBusy(true);
    setCommentError("");
    try {
      const created = await api.create(commentDraft);
      setComments((items) => [...(items ?? []), created]);
      setCommentDraft("");
      setCommentPreview(false);
      void refreshActivity();
    } catch (cause) {
      setCommentError(translateError(cause, t, "repositories:issues.detail.commentFailed"));
    } finally { setBusy(false); }
  };

  const removeComment = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    setDialogError("");
    try {
      await api.remove(deleting.id);
      setComments((items) => items?.filter((entry) => entry.id !== deleting.id) ?? []);
      setDeleting(undefined);
      void refreshActivity();
    } catch (cause) {
      setDialogError(translateError(cause, t, "repositories:issues.detail.commentFailed"));
    } finally { setBusy(false); }
  };

  const toggleMinimized = async (entry: IssueComment) => {
    if (!moderator || busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api.minimize(entry.id, entry.minimized ? undefined : "off-topic");
      setComments((items) => items?.map((comment) => comment.id === updated.id ? updated : comment) ?? []);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:issues.detail.commentFailed"));
    } finally { setBusy(false); }
  };

  const toggleLock = async () => {
    if (!issue || !moderator || busy) return;
    setBusy(true);
    setDialogError("");
    try {
      setIssue(await api.lock(issue.locked ? undefined : lockReason));
      setLockDialog(false);
      void refreshActivity();
    } catch (cause) {
      setDialogError(translateError(cause, t, "repositories:issues.detail.updateFailed"));
    } finally { setBusy(false); }
  };

  const toggleSubscription = async () => {
    if (subscribed === undefined || busy) return;
    setBusy(true);
    setSubscriptionFailed(false);
    try { setSubscribed(await api.subscribe(!subscribed)); } catch { setSubscriptionFailed(true); } finally { setBusy(false); }
  };

  const handleClose = async () => {
    if (!issue) return;
    setBusy(true);
    setError("");
    setCloseError("");
    try {
      const updated = await issuesAPI.close(organization.id, issueNumber, repository, closeReason);
      setIssue(updated);
      setShowCloseDialog(false);
      void refreshActivity();
      onNotify(t("issues.detail.closeSuccess"));
    } catch (cause) {
      setCloseError(translateError(cause, t, "repositories:issues.detail.closeFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async () => {
    if (!issue) return;
    setBusy(true);
    setError("");
    try {
      const updated = await issuesAPI.reopen(organization.id, issueNumber, repository);
      setIssue(updated);
      void refreshActivity();
      onNotify(t("issues.detail.reopenSuccess"));
    } catch (cause) {
      setError(translateError(cause, t, "repositories:issues.detail.reopenFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section className="issue-detail card">
        <div className="org-loading">{t("issues.detail.loading")}</div>
      </section>
    );
  }

  if (!issue) {
    return (
      <section className="issue-detail card">
        <div className="org-error" role="alert">
          {error || t("issues.detail.loadFailed")}
        </div>
      </section>
    );
  }

  const participants = [...new Set([issue.created_by, ...(comments ?? []).map((entry) => entry.author_id)])];
  const activity = [
    ...(comments ?? []).map((entry) => ({ kind: "comment" as const, entry })),
    ...(githubSource?.references ?? []).map((entry, index) => ({ kind: "github" as const, entry, index })),
    ...events.filter((entry) => entry.event_type !== "created" && entry.event_type !== "commented").map((entry) => ({ kind: "event" as const, entry })),
  ].sort((a, b) => a.entry.created_at.localeCompare(b.entry.created_at));
  const lockLabel = t(issue.locked ? "issues.detail.unlock" : "issues.detail.lock");

  return (
    <>
      <section className="issue-detail">
        <header className="issue-detail__header">
          <div className="issue-detail__title-row">
            <h2 className="issue-detail__title">
              {issue.title}{" "}<span className="issue-number">#{issue.number}</span>
            </h2>
            <div className="issue-detail__title-actions">
              {canEdit && <Button variant="ghost" size="small" aria-label={t("common:actions.edit")} title={t("issues.detail.editTitle")} onClick={() => startEdit("title")} disabled={busy}><Pencil size={16} aria-hidden="true" /></Button>}
              {canWrite && <Link className="af-button af-button--primary af-button--small" to={issueTemplatePath(handle, repository)}>{t("issues.newIssue")}</Link>}
              <Button variant="ghost" size="small" aria-label={t("issues.detail.copyIssueLink")} onClick={() => void copy(linkFor())}><Copy size={16} aria-hidden="true" /></Button>
            </div>
          </div>
          <div className="issue-detail__meta">
            <span className={`issue-state-badge issue-state-${issue.state}`}>
              {issue.state === "open" ? (
                <>
                  <AlertCircle size={14} aria-hidden="true" /> {t("issues.state.open")}
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} aria-hidden="true" /> {t("issues.state.closed")}
                </>
              )}
            </span>
            <span>{t("issues.detail.commentCount", { count: comments?.length ?? issue.comments })}</span>
            {issue.locked && <span><Lock size={14} aria-hidden="true" /> {t("issues.detail.locked")}</span>}
            {issue.closed_at && issue.closed_by && (
              <span>
                {t("issues.detail.closedBy", {
                  author: authorName(issue.closed_by),
                  date: formatDateTime(issue.closed_at),
                })}
              </span>
            )}
          </div>
        </header>

        {error && (
          <div className="org-error" role="alert">
            {error}
          </div>
        )}

        <div className="issue-detail__layout">
          <div className="issue-detail__conversation">
            <section id="issue-description" className="issue-detail__description issue-detail__description--original" aria-label={t("issues.detail.description")}>
              <header>
                <span>{t("issues.detail.createdBy", { author: issue.created_by_name || authorName(issue.created_by), date: formatDateTime(issue.created_at) })}</span>
                <IssuePostMenu copyLink={() => void copy(linkFor("#issue-description"))} copyMarkdown={() => void copy(issue.body)} quote={() => quote(issue.body)} canQuote={canComment && !!issue.body}>
                  {canEdit && <Button variant="ghost" onClick={() => startEdit("body")}>{t("common:actions.edit")}</Button>}
                  {canWrite && <Button variant="ghost" onClick={() => startReport()}>{t("issues.detail.report")}</Button>}
                </IssuePostMenu>
              </header>
              <div className="issue-detail__body">
                {issue.body ? <IssueMarkdown {...context} content={issue.body} /> : <p className="issue-detail__no-description">{t("issues.detail.noDescription")}</p>}
              </div>
              <IssueDetailLinks api={api} context={context} issueNumber={issueNumber} canEdit={canEdit}>
                <IssueReactions api={api} user={currentUser} canReact={canComment} />
              </IssueDetailLinks>
            </section>
            {activityError && <p role="alert">{activityError} <Button variant="ghost" size="small" onClick={() => void refreshActivity()}>{t("issues.composer.retry")}</Button></p>}
            <section className="issue-activity" aria-label={t("issues.detail.timeline")}>
              {activity.map((item) => {
                const { kind, entry } = item;
                if (kind === "github") {
                  const { actor, url, title, number, created_at } = item.entry;
                  return <div className="issue-activity__event" key={`github:${url}:${item.index}`}>
                    <GitBranch size={16} aria-hidden="true" />
                    <span><strong>{actor || t("issues.detail.github")}</strong> {t("issues.detail.githubMentioned")} <a href={url} target="_blank" rel="noreferrer">{title} #{number}</a></span>
                    <time dateTime={created_at}>{formatDateTime(created_at)}</time>
                  </div>;
                }
                return kind === "event" ? <div className="issue-activity__event" key={`event:${entry.id}`}>
                <GitBranch size={16} aria-hidden="true" />
                <span><strong>{authorName(entry.actor_id)}</strong> {t(`issues.detail.event.${entry.event_type}`, { defaultValue: t("issues.detail.event.updated") })}
                  {entry.metadata?.changeset_id && <> <Link to={changesetPath(handle, entry.metadata.changeset_id)}>
                    {issue.changesets?.find(({ id }) => id === entry.metadata?.changeset_id)?.title ?? t("issues.detail.changeset")}
                  </Link></>}
                </span>
                <time dateTime={entry.created_at}>{formatDateTime(entry.created_at)}</time>
              </div> : <article key={entry.id} id={`issuecomment-${entry.id}`} className="issue-detail__description" aria-label={t("issues.detail.commentBy", { author: authorName(entry.author_id) })}>
                <header>
                  <span><strong>{authorName(entry.author_id)}</strong> · <time dateTime={entry.created_at}>{formatDateTime(entry.created_at)}</time>{entry.edited_at && <> · {t("issues.detail.edited")}</>}</span>
                  <IssuePostMenu copyLink={() => void copy(linkFor(`#issuecomment-${entry.id}`))} copyMarkdown={() => void copy(entry.body)} quote={() => quote(entry.body)} canQuote={canComment && !entry.minimized}>
                    {canWrite && (moderator || entry.author_id === currentUser) && <>
                      <Button variant="ghost" onClick={() => startEdit(entry)}>{t("common:actions.edit")}</Button>
                      <Button variant="ghost" onClick={() => { setDialogError(""); setDeleting(entry); }}>{t("issues.detail.deleteComment")}</Button>
                    </>}
                    {moderator && <Button variant="ghost" disabled={busy} onClick={() => void toggleMinimized(entry)}>{t(entry.minimized ? "issues.detail.showComment" : "issues.detail.hideComment")}</Button>}
                  {canWrite && <Button variant="ghost" onClick={() => startReport(entry.id)}>{t("issues.detail.report")}</Button>}
                  </IssuePostMenu>
                </header>
                {entry.minimized ? <details className="issue-detail__body"><summary>{t("issues.detail.hiddenComment")}</summary><IssueMarkdown {...context} content={entry.body} /></details>
                  : <div className="issue-detail__body"><IssueMarkdown {...context} content={entry.body} /></div>}
                {!entry.minimized && <footer className="issue-detail__post-footer"><IssueReactions api={api} commentID={entry.id} user={currentUser} canReact={canComment} /></footer>}
              </article>;
              })}
            </section>
            {canComment && <form className="issue-add-comment" onSubmit={(event) => { event.preventDefault(); void submitComment(); }}>
              <h3><MessageSquare size={16} aria-hidden="true" /> {t("issues.detail.addComment")}</h3>
              <IssueTextEditor context={context} label={t("issues.detail.commentBody")} value={commentDraft} onChange={setCommentDraft} fieldRef={commentField} preview={commentPreview} setPreview={setCommentPreview} busy={busy} />
              {commentError && <p role="alert" className="org-error">{commentError}</p>}
              <div className="issue-detail__actions"><Button type="submit" size="small" disabled={busy || !commentDraft.trim()}>{t("issues.detail.commentAction")}</Button></div>
            </form>}
            {issue.locked && !canComment && <p>{t("issues.detail.lockedNotice")}</p>}
            {canEdit && <div className="issue-detail__actions">
              {issue.state === "open" ? (
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => {
                    setCloseError("");
                    setCloseReason("completed");
                    setShowCloseDialog(true);
                  }}
                  disabled={busy}
                >
                  {t("issues.detail.closeIssue")}
                </Button>
              ) : (
                <Button variant="secondary" size="small" onClick={handleReopen} disabled={busy}>
                  {t("issues.detail.reopenIssue")}
                </Button>
              )}
            </div>}
          </div>

          {/* Sidebar with metadata */}
          <aside className="issue-detail__sidebar">
            {/* Assignees */}
            <div className="issue-sidebar-section">
              {metadataHeading("assignees")}
              {issue.assignees.length > 0 ? (
                <ul className="issue-assignee-list">
                  {issue.assignees.map((assignee) => (
                    <li key={assignee.user_id}>{assignee.display_name || assignee.user_id}</li>
                  ))}
                </ul>
              ) : (
                <p className="issue-sidebar-empty">{t("issues.noAssignees")}{moderator && <Button variant="ghost" size="small" disabled={busy}
                  onClick={() => void saveMetadata({ assignees: [currentUser], expected_updated_at: issue.updated_at })}>{t("issues.detail.assignSelf")}</Button>}</p>
              )}
            </div>

            {/* Labels */}
            <div className="issue-sidebar-section">
              {metadataHeading("label_ids")}
              {issue.labels.length > 0 ? (
                <div className="issue-label-list">
                  {issue.labels.map((label) => (
                    <span
                      key={label.id}
                      className="issue-label-badge"
                      style={{ borderColor: `#${label.color}` }}
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="issue-sidebar-empty">{t("issues.noLabels")}</p>
              )}
            </div>

            <div className="issue-sidebar-section">
              {metadataHeading("issue_type")}
              <p>{t(`issues.type.${issue.issue_type || "none"}`)}</p>
            </div>

            <IssueDetailFields issue={issue} editable={moderator} busy={busy} error={dialogError}
              resetError={() => setDialogError("")} save={saveMetadata} />

            {/* Milestone */}
            <div className="issue-sidebar-section">
              {metadataHeading("milestone_id")}
              {issue.milestone_id ? (
                <p>{issue.milestone_title || issue.milestone_id}</p>
              ) : (
                <p className="issue-sidebar-empty">{t("issues.noMilestone")}</p>
              )}
            </div>

            <div className="issue-sidebar-section">
              {metadataHeading("project_ids")}
              {issue.projects?.length ? <ul>{issue.projects.map(({ id, name, number }) => <li key={id}>{number ? <Link to={projectPath(handle, number)}>{name}</Link> : name}</li>)}</ul> : <p className="issue-sidebar-empty">{t("issues.projects.empty")}</p>}
            </div>
            <IssueDevelopment issue={issue} context={context} editable={moderator} busy={busy} error={dialogError}
              resetError={() => setDialogError("")} save={saveMetadata} />
            <div className="issue-sidebar-section">
              <h3>{t("issues.detail.notifications")}</h3>
              {subscribed !== undefined && <Button variant="secondary" size="small" disabled={busy} onClick={() => void toggleSubscription()}>{t(subscribed ? "issues.detail.unsubscribe" : "issues.detail.subscribe")}</Button>}
              {subscriptionFailed && <p role="alert">{t("issues.detail.subscriptionFailed")} <Button variant="ghost" size="small" onClick={() => void refreshSubscription()}>{t("issues.composer.retry")}</Button></p>}
            </div>
            <div className="issue-sidebar-section">
              <h3>{t("issues.detail.participants", { count: participants.length })}</h3>
              <ul className="issue-assignee-list">{participants.map((user) => <li key={user}>{authorName(user)}</li>)}</ul>
            </div>
            <IssueGitHubSourceActions key={`${repository}:${issue.id}`} api={api} value={githubSource} onChange={setGitHubSource} editable={moderator} />
            {moderator && <div className="issue-sidebar-section">
              <Button variant="ghost" size="small" disabled={busy} onClick={() => { setDialogError(""); setLockReason(lockReasons[0]); setLockDialog(true); }}><Lock size={14} aria-hidden="true" /> {lockLabel}</Button>
              <Button variant="ghost" size="small" disabled={busy} onClick={() => void beginTransfer()}><ArrowRight size={14} aria-hidden="true" /> {t("issues.detail.transfer")}</Button>

            </div>}

            {/* Metadata */}
            <div className="issue-sidebar-section">
              <h3>{t("issues.detail.metadata")}</h3>
              <dl className="issue-metadata">
                <dt>{t("issues.detail.created")}</dt>
                <dd>{formatDateTime(issue.created_at)}</dd>
                <dt>{t("issues.detail.updated")}</dt>
                <dd>{formatDateTime(issue.updated_at)}</dd>
                {issue.closed_at && (
                  <>
                    <dt>{t("issues.detail.closed")}</dt>
                    <dd>{formatDateTime(issue.closed_at)}</dd>
                  </>
                )}
              </dl>
            </div>
          </aside>
        </div>
      </section>

      {transfer && <Modal open title={t("issues.detail.transfer")} onCancel={() => setTransfer(undefined)} onOk={submitTransfer}
        okText={t("issues.detail.transfer")} okDisabled={!transfer.target} confirmLoading={busy}>
        <p>{t("issues.detail.transferPrompt")}</p>
        {dialogError && <p role="alert">{dialogError}</p>}
        {transfer.error && <p role="alert">{transfer.error} <Button variant="ghost" size="small" onClick={() => void beginTransfer()}>{t("issues.composer.retry")}</Button></p>}
        {transfer.loading ? <p role="status">{t("common:components.loading")}</p> : transfer.choices.length ?
          <Select label={t("issues.detail.transferRepository")} placeholder={t("issues.detail.chooseTransferRepository")} value={transfer.target} disabled={busy}
            options={transfer.choices.map((value) => ({ value, label: value }))} onChange={(event) => setTransfer({ ...transfer, target: event.target.value })} />
          : !transfer.error && <p>{t("issues.detail.noTransferRepositories")}</p>}
      </Modal>}
      {metadata && <Modal open onCancel={() => setMetadata(undefined)} title={t("issues.detail.editMetadata", { field: metadataLabels[metadata.field] })}
        confirmLoading={busy} okText={t("issues.form.updateIssue")} onOk={() => saveMetadata({ [metadata.field]: metadata.draft[metadata.field], expected_updated_at: metadata.version }, () => setMetadata(undefined))}>
        {dialogError && <p role="alert">{dialogError}</p>}
        <fieldset disabled={busy} className="issue-detail__metadata-editor"><IssueCreateMetadata organizationID={organization.id}
          owner={repository.split("/")[0]} repo={repository.split("/")[1]} value={metadata.draft} field={metadata.field}
          onChange={(draft) => setMetadata({ ...metadata, draft })} /></fieldset>
      </Modal>}
      {report && <Modal open onCancel={() => setReport(undefined)} title={t("issues.detail.report")} okText={t("issues.detail.report")}
        confirmLoading={busy} onOk={submitReport}>
        {dialogError && <p role="alert">{dialogError}</p>}
        <Select label={t("issues.detail.reportReason")} value={report.reason} disabled={busy}
          options={reportReasons.map((value) => ({ value, label: t(`issues.detail.reportReasons.${value}`) }))}
          onChange={(event) => setReport({ ...report, reason: reportReasons.find((reason) => reason === event.target.value) ?? reportReasons[0] })} />
        <TextArea aria-label={t("issues.detail.reportDetails")} value={report.details} rows={4} maxLength={2000} disabled={busy}
          onChange={(event) => setReport({ ...report, details: event.target.value })} />
      </Modal>}
      {edit && <Modal open onCancel={() => setEdit(undefined)} title={t(edit.target === "title" ? "issues.detail.editIssue" : edit.target === "body" ? "issues.detail.editDescription" : "issues.detail.editComment")}
        confirmLoading={busy} onOk={saveEdit} okText={t("issues.form.updateIssue")} okDisabled={edit.target !== "body" && !edit.value.trim()}>
        {dialogError && <p className="org-error" role="alert">{dialogError}</p>}
        {edit.target === "title" ? <Input aria-label={t("issues.form.title")} value={edit.value} maxLength={500} disabled={busy}
          onChange={(event) => setEdit({ ...edit, value: event.target.value })} />
          : <IssueTextEditor context={context} label={t("issues.form.body")} value={edit.value} onChange={(value) => setEdit({ ...edit, value })} preview={editPreview} setPreview={setEditPreview} busy={busy} />}
      </Modal>}
      {deleting && <Modal open onCancel={() => setDeleting(undefined)} onOk={removeComment} title={t("issues.detail.deleteComment")} okText={t("issues.detail.deleteComment")} okVariant="danger" confirmLoading={busy}>
        <p>{t("issues.detail.deleteCommentPrompt")}</p>
        {dialogError && <p className="org-error" role="alert">{dialogError}</p>}
      </Modal>}
      {lockDialog && <Modal open onCancel={() => setLockDialog(false)} onOk={toggleLock} title={lockLabel} okText={lockLabel} confirmLoading={busy}>
        <p>{t(issue.locked ? "issues.detail.unlockPrompt" : "issues.detail.lockPrompt")}</p>
        {dialogError && <p className="org-error" role="alert">{dialogError}</p>}
        {!issue.locked && <Select aria-label={t("issues.detail.lockReason")} value={lockReason} disabled={busy}
          onChange={(event) => setLockReason(lockReasons.find((reason) => reason === event.target.value) ?? lockReasons[0])}
          options={lockReasons.map((reason) => ({ value: reason, label: t(`issues.detail.lockReasons.${reason}`) }))} />}
      </Modal>}

      {/* Close Dialog */}
      {showCloseDialog && (
        <Modal
          open={showCloseDialog}
          onCancel={() => setShowCloseDialog(false)}
          title={t("issues.detail.closeIssue")}
          confirmLoading={busy}
        >
          <div className="issue-close-dialog">
            <p>{t("issues.detail.closeDialogMessage")}</p>
            {closeError && <p className="org-error" role="alert">{closeError}</p>}
            <div className="issue-form-field">
              <Select
                label={t("issues.detail.closeReason")}
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value as IssueStateReason)}
                options={[
                  { label: t("issues.closeReason.completed"), value: "completed" },
                  { label: t("issues.closeReason.notPlanned"), value: "not_planned" },
                  { label: t("issues.closeReason.duplicate"), value: "duplicate" },
                ]}
                disabled={busy}
              />
            </div>
            <div className="issue-form-actions">
              <Button
                variant="secondary"
                onClick={() => setShowCloseDialog(false)}
                disabled={busy}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button variant="primary" onClick={handleClose} disabled={busy}>
                {busy ? t("common:components.loading") : t("issues.detail.confirmClose")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
