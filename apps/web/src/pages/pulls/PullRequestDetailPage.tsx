import { useCallback, useEffect, useState } from "react";
import { GitPullRequest, GitMerge, X, Check, FileText, GitCommitHorizontal, CheckCircle2, FileCode } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { changesetAPI, type OrganizationSummary, type StoredChangeset, organizationAPI, type OrganizationMember } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { pullRequestPath, repositoryPath, type PullRequestTab } from "../../shared/routing";
import { Button, Select, Tabs, type TabsItem, ConfirmDialog } from "../../shared/ui";
import { PullRequestConversationTab } from "./PullRequestConversationTab";
import { PullRequestCommitsTab } from "./PullRequestCommitsTab";
import { PullRequestChecksTab } from "./PullRequestChecksTab";
import { PullRequestFilesTab } from "./PullRequestFilesTab";

type Props = {
  organization: OrganizationSummary;
  repository: string;
  handle: string;
  pullNumber: string;
  tab: PullRequestTab;
  userID: string;
};

function pullRequestState(changeset: StoredChangeset): "draft" | "open" | "closed" | "merged" {
  if (changeset.status === "merged") return "merged";
  if (changeset.changeset.pull_request?.closed) return "closed";
  if (changeset.changeset.pull_request?.draft) return "draft";
  return "open";
}

export function PullRequestDetailPage({ organization, repository, handle, pullNumber, tab, userID }: Props) {
  const { t } = useTranslation(["pulls", "common", "changesets"]);
  const navigate = useNavigate();
  const [changeset, setChangeset] = useState<StoredChangeset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [reviewerID, setReviewerID] = useState("");
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await changesetAPI.get(organization.id, pullNumber);
      if (!result.changeset.pull_request || result.changeset.repository !== repository) {
        setError(t("pulls:errors.loadFailed"));
        return;
      }
      setChangeset(result);
    } catch (cause) { setError(translateError(cause, t, "pulls:errors.loadFailed")); }
    finally { setLoading(false); }
  }, [organization.id, pullNumber, repository, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let live = true;
    void organizationAPI.members(organization.id)
      .then(result => { if (live) setMembers(result.items); })
      .catch(() => { /* The current member remains available if eligible. */ });
    return () => { live = false; };
  }, [organization.id]);

  const run = async (action: () => Promise<StoredChangeset>, errorKey = "pulls:actions.stateChangeFailed") => {
    setActionBusy(true); setError("");
    try { setChangeset(await action()); }
    catch (cause) { setError(translateError(cause, t, errorKey)); }
    finally { setActionBusy(false); }
  };
  const updateState = (action: "ready" | "draft" | "close" | "reopen") =>
    run(() => changesetAPI.updatePullRequestState(organization.id, pullNumber, action));

  if (loading) return <div className="org-loading">{t("pulls:detail.loading")}</div>;
  if (!changeset) return <div className="org-error" role="alert">{error || t("pulls:detail.loadFailed")}</div>;

  const pr = changeset.changeset.pull_request!;
  const state = pullRequestState(changeset);
  const canWrite = organization.role !== "viewer";
  const canManage = canWrite && (changeset.changeset.created_by === userID || ["owner", "admin"].includes(organization.role));
  const canMerge = canWrite && state === "open" && changeset.status === "ready_to_merge";
  const activeRevision = changeset.changeset.revisions[changeset.changeset.revisions.length - 1];

  const review = changeset.changeset.reviews.slice().reverse().find(item => item.revision_id === activeRevision?.id && item.status !== "superseded" && item.status !== "stale");
  const memberName = (id: string) => members.find(member => member.user_id === id)?.display_name || id;
  const reviewerOptions = [
    { value: "", label: t("pulls:sidebar.assignReviewer") },
    ...(userID && userID !== changeset.changeset.created_by ? [{ value: userID, label: t("pulls:review.yourself") }] : []),
    ...members.filter(member => member.user_id !== userID && member.user_id !== changeset.changeset.created_by && member.status === "active" && member.role !== "viewer")
      .map(member => ({ value: member.user_id, label: member.display_name || member.user_id })),
  ];
  const selectedReviewer = reviewerOptions.some(option => option.value === reviewerID) ? reviewerID : "";
  const merge = async () => {
    setShowMergeConfirm(false);
    await run(() => changesetAPI.merge(organization.id, pullNumber, pr.base_branch), "pulls:actions.mergeFailed");
  };
  const tabs: TabsItem[] = [
    { key: "conversation", label: <>{<FileText size={16}/>}{t("pulls:detail.tabs.conversation")}</> },
    { key: "commits", label: <>{<GitCommitHorizontal size={16}/>}{t("pulls:detail.tabs.commits")}</> },
    { key: "checks", label: <>{<CheckCircle2 size={16}/>}{t("pulls:detail.tabs.checks")}</> },
    { key: "files", label: <>{<FileCode size={16}/>}{t("pulls:detail.tabs.files")}</> },
  ];

  return <section className="pull-request-detail-page">
    <Link to={repositoryPath(handle, repository, "pulls")}>{t("pulls:detail.backToList")}</Link>
    <div className="pull-request-header card">
      <div className="pull-request-title-row">
        <h1>
          {changeset.changeset.title}
          {state === "draft" && <span className="pull-draft-badge">{t("pulls:detail.draft")}</span>}
        </h1>
        <div className="pull-request-actions">
          {canManage && state === "draft" && (
            <Button className="button secondary" onClick={() => updateState("ready")} disabled={actionBusy}>
              <Check size={14}/> {t("pulls:actions.markReady")}
            </Button>
          )}
          {canManage && state === "open" && (
            <Button className="button secondary" onClick={() => updateState("draft")} disabled={actionBusy}>
              {t("pulls:actions.markDraft")}
            </Button>
          )}
          {canManage && (state === "open" || state === "draft") && (
            <Button className="button secondary" onClick={() => updateState("close")} disabled={actionBusy}>
              <X size={14}/> {t("pulls:actions.close")}
            </Button>
          )}
          {canManage && state === "closed" && (
            <Button className="button secondary" onClick={() => updateState("reopen")} disabled={actionBusy}>
              {t("pulls:actions.reopen")}
            </Button>
          )}
          {canMerge && (
            <Button className="button primary" onClick={() => setShowMergeConfirm(true)} disabled={actionBusy}>
              <GitMerge size={14}/> {t("pulls:actions.merge")}
            </Button>
          )}
        </div>
      </div>
      <div className="pull-request-meta">
        <span className={`pull-state pull-state-${state}`}>
          <GitPullRequest size={14}/> {t(`pulls:state.${state}`)}
        </span>
        <span>
          {t("pulls:detail.openedBy", {
            author: memberName(changeset.changeset.created_by),
            source: pr.source_branch,
            base: pr.base_branch,
          })}
        </span>
      </div>
    </div>

    {error && <div className="org-error" role="alert">{error}</div>}

    <Tabs
      items={tabs}
      value={tab}
      ariaLabel={t("pulls:list.title")}
      onChange={id => navigate(pullRequestPath(handle, repository, pullNumber, id as PullRequestTab))}
    />

    <div className="pull-request-content">
      {tab === "conversation" && <div className="pull-conversation-layout">
        <PullRequestConversationTab
          organization={organization}
          changeset={changeset}
          pullNumber={pullNumber}
          onUpdate={setChangeset}
          memberName={memberName}
        />
        <aside className="pull-review-sidebar card">
          <h3>{t("pulls:sidebar.reviewers")}</h3>
          <p>{review ? t(`pulls:review.${review.status}`) : t("pulls:sidebar.noReviewers")}</p>
          {review && <p>{memberName(review.reviewer)}</p>}
          {canWrite && state === "open" && activeRevision && <>
            <form onSubmit={event => { event.preventDefault(); if (selectedReviewer) void run(() => changesetAPI.assignReview(organization.id, pullNumber, selectedReviewer, "")); }}>
              <Select aria-label={t("pulls:sidebar.reviewers")} value={selectedReviewer} onChange={event => setReviewerID(event.target.value)} options={reviewerOptions}/>
              <Button type="submit" disabled={actionBusy || !selectedReviewer || !["review_required", "in_review", "changes_requested"].includes(changeset.status)}>{t("changesets:detail.assignReviewButton")}</Button>
            </form>
            {review?.reviewer === userID && review.status === "pending" && <div className="org-actions">
              <Button disabled={actionBusy} onClick={() => void run(() => changesetAPI.decideReview(organization.id, pullNumber, review.id, true, ""))}>{t("changesets:detail.approveButton")}</Button>
              <Button disabled={actionBusy} onClick={() => void run(() => changesetAPI.decideReview(organization.id, pullNumber, review.id, false, ""))}>{t("changesets:detail.requestChangesButton")}</Button>
            </div>}
          </>}
          {activeRevision && <p><code title={activeRevision.commit_sha}>{activeRevision.commit_sha.slice(0, 12)}</code></p>}
          {canWrite && (state === "open" || state === "draft") && <Button disabled={actionBusy} onClick={() => void run(() => changesetAPI.addRevision(organization.id, pullNumber, pr.source_branch))}>{t("pulls:actions.refresh")}</Button>}
          {state === "open" && !canMerge && <p>{t("pulls:actions.mergeRequirements")}</p>}
          {changeset.changeset.merge && <p><code>{changeset.changeset.merge.commit_sha}</code></p>}
        </aside>
      </div>}
      {tab === "commits" && (
        <PullRequestCommitsTab
          organization={organization}
          changeset={changeset}
        />
      )}
      {tab === "checks" && (
        <PullRequestChecksTab
          changeset={changeset}
          activeRevision={activeRevision}
          canEvaluate={canWrite && !actionBusy && state !== "merged" && state !== "closed" && !!activeRevision}
          onEvaluate={() => void run(() => changesetAPI.evaluate(organization.id, pullNumber))}
        />
      )}
      {tab === "files" && (
        <PullRequestFilesTab
          organization={organization}
          changeset={changeset}
          pullNumber={pullNumber}
          onUpdate={setChangeset}
        />
      )}
    </div>

    <ConfirmDialog
      open={showMergeConfirm}
      title={t("pulls:actions.merge")}
      description={t("pulls:actions.confirmMerge", { source: pr.source_branch, base: pr.base_branch })}
      confirmText={t("pulls:actions.merge")}
      onConfirm={merge}
      onCancel={() => setShowMergeConfirm(false)}
    />
  </section>;
}
