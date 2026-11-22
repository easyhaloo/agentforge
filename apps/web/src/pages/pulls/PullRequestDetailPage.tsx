import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CircleCheck, ClipboardCheck, FileDiff, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Layers3, MessagesSquare } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { changesetAPI, type OrganizationSummary, type StoredChangeset, type PullRequestComparison, organizationAPI, type OrganizationMember } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { changesetPath, pullRequestPath, repositoryPath, type PullRequestTab } from "../../shared/routing";
import { Button, Select, Tabs, type TabsItem, ConfirmDialog } from "../../shared/ui";
import { parseRepositoryDiff } from "../repositories/repositoryDiff";
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

const tabListId = "pull-request-detail";
const stateIcons = { open: GitPullRequest, draft: GitPullRequestDraft, closed: GitPullRequestClosed, merged: GitMerge };

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
  const [lifecycleError, setLifecycleError] = useState("");
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [reviewerID, setReviewerID] = useState("");
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [comparison, setComparison] = useState<{ revisionKey: string; data?: PullRequestComparison; error?: string }>();
  const [comparisonRetry, setComparisonRetry] = useState(0);
  const current = changeset?.changeset.id === pullNumber && changeset.changeset.repository === repository && changeset.changeset.pull_request
    ? changeset : null;
  const activeRevision = current?.changeset.revisions.at(-1);
  const revisionKey = activeRevision ? `${organization.id}/${pullNumber}/${activeRevision.id}` : "";
  const revisionHead = activeRevision?.commit_sha;
  const currentComparison = comparison?.revisionKey === revisionKey ? comparison : undefined;
  const patch = currentComparison?.data?.patch;
  const files = useMemo(() => patch === undefined ? undefined : parseRepositoryDiff(patch), [patch]);

  useEffect(() => {
    if (!revisionKey) return;
    let live = true;
    void changesetAPI.getComparison(organization.id, pullNumber).then(data => {
      if (!live) return;
      if (data.head_sha !== revisionHead || data.repository !== repository) {
        setComparison({ revisionKey, error: t("pulls:errors.comparisonChanged") });
        return;
      }
      setComparison({ revisionKey, data });
    }).catch(cause => {
      if (live) setComparison({ revisionKey, error: translateError(cause, t, "pulls:errors.compareFailed") });
    });
    return () => { live = false; };
  }, [organization.id, pullNumber, repository, revisionHead, revisionKey, comparisonRetry, t]);

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

  const run = async (
    action: () => Promise<StoredChangeset>,
    errorKey = "pulls:actions.stateChangeFailed",
    reportError = setError,
  ) => {
    setActionBusy(true); reportError("");
    try { setChangeset(await action()); }
    catch (cause) { reportError(translateError(cause, t, errorKey)); }
    finally { setActionBusy(false); }
  };
  const updateState = (action: "ready" | "draft" | "close" | "reopen") =>
    run(
      () => changesetAPI.updatePullRequestState(organization.id, pullNumber, action),
      "pulls:actions.stateChangeFailed",
      action === "close" || action === "reopen" ? setLifecycleError : setError,
    );

  if (loading) return <div className="org-loading">{t("pulls:detail.loading")}</div>;
  if (!current || !changeset) return <div className="org-error" role="alert">{error || t("pulls:detail.loadFailed")}</div>;

  const pr = changeset.changeset.pull_request!;
  const state = pullRequestState(changeset);
  const canWrite = organization.role !== "viewer";
  const canManage = canWrite && (changeset.changeset.created_by === userID || ["owner", "admin"].includes(organization.role));
  const lifecycleAction = canManage && state !== "merged" ? (state === "closed" ? "reopen" : "close") : undefined;
  const canMerge = canWrite && state === "open" && changeset.status === "ready_to_merge";
  const StateIcon = stateIcons[state];
  const activeEvaluation = changeset.changeset.evaluations.slice().reverse().find(item => item.revision_id === activeRevision?.id);
  const activeEvidence = changeset.changeset.evidence.filter(item => item.revision_id === activeRevision?.id && item.evaluation_id === activeEvaluation?.id && item.status === "active");
  const evidenceStatus = activeEvaluation?.status === "failed" ? "failed" :
    activeEvaluation?.status === "passed" && activeEvidence.length > 0 ? "passed" : "required";
  const commitCount = currentComparison?.data && `${currentComparison.data.commits.length}${currentComparison.data.commits_truncated ? "+" : ""}`;

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
    { key: "conversation", icon: MessagesSquare, count: pr.comments.length },
    { key: "commits", icon: GitCommitHorizontal, count: commitCount },
    { key: "checks", icon: ClipboardCheck, count: activeEvaluation ? 1 : 0 },
    { key: "files", icon: FileDiff, count: files?.length },
  ].map(({ key, icon: Icon, count }) => ({ key, label: <>
    <Icon size={18} aria-hidden="true"/>
    <span>{t(`pulls:detail.tabs.${key}`)}</span>
    {count !== undefined && <span className="pull-tab-count">{count}</span>}
  </> }));
  const showComparison = tab === "commits" || tab === "files";
  const retryComparison = () => {
    setComparison(undefined);
    setComparisonRetry(attempt => attempt + 1);
    void load();
  };

  return <section className="pull-request-detail-page">
    <Link className="pull-back-link" to={repositoryPath(handle, repository, "pulls")}>
      <ArrowLeft size={16} aria-hidden="true"/>{t("pulls:detail.backToList")}
    </Link>
    <header className="pull-request-header">
      <div className="pull-request-title-row">
        <h1>{changeset.changeset.title}</h1>
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
        </div>
      </div>
      <div className="pull-request-meta">
        <span className={`pull-state pull-state-${state}`}>
          <StateIcon size={16} aria-hidden="true"/>{t(`pulls:state.${state}`)}
        </span>
        <span>
          <Trans t={t} i18nKey="pulls:detail.branchSummary" count={currentComparison?.data?.commits_truncated ? undefined : currentComparison?.data?.commits.length}
            components={{
              author: <strong>{memberName(changeset.changeset.created_by)}</strong>,
              source: <code className="pull-branch">{pr.source_branch}</code>,
              base: <code className="pull-branch">{pr.base_branch}</code>,
            }}/>
        </span>
      </div>
    </header>

    {error && <div className="org-error" role="alert">{error}</div>}

    <Tabs
      id={tabListId}
      className="pull-detail-tabs"
      items={tabs}
      value={tab}
      ariaLabel={t("pulls:list.title")}
      onChange={id => { if (id !== tab) void navigate(pullRequestPath(handle, repository, pullNumber, id as PullRequestTab)); }}
    />

    <div className="pull-request-content" id={`${tabListId}-panel`} role="tabpanel" aria-labelledby={`${tabListId}-tab-${tab}`} tabIndex={0}>
      {showComparison && !currentComparison && <div className="org-loading" role="status">{t("common:status.loading")}</div>}
      {showComparison && currentComparison?.error && <div className="org-error" role="alert">
        {currentComparison.error} <Button onClick={retryComparison}>{t("pulls:actions.retry")}</Button>
      </div>}
      {tab === "conversation" && <div className="pull-conversation-layout">
        <PullRequestConversationTab
          organization={organization}
          changeset={changeset}
          pullNumber={pullNumber}
          onUpdate={setChangeset}
          memberName={memberName}
          lifecycleAction={lifecycleAction}
          lifecycleError={lifecycleError}
          onLifecycleAction={updateState}
          actionBusy={actionBusy}
        >
          <section className="pull-merge-gate" aria-label={t("pulls:gate.mergeTitle")}>
            <div className="pull-merge-gate-main">
              <GitMerge size={20} aria-hidden="true"/>
              <div>
                <h3>{state === "merged" ? t("pulls:gate.merged") : t("pulls:gate.mergeTitle")}</h3>
                {state === "merged" && changeset.changeset.merge ? <code title={changeset.changeset.merge.commit_sha}>{changeset.changeset.merge.commit_sha.slice(0, 12)}</code>
                  : <p>{canMerge ? t("pulls:gate.ready") : state === "open" ? t("pulls:actions.mergeRequirements") : t(`pulls:state.${state}`)}</p>}
              </div>
            </div>
            {canMerge && <Button variant="primary" onClick={() => setShowMergeConfirm(true)} disabled={actionBusy}>{t("pulls:actions.merge")}</Button>}
          </section>
        </PullRequestConversationTab>
        <aside className="pull-review-sidebar">
          <section className="pull-changeset-summary">
            <h3><Layers3 size={17} aria-hidden="true"/>{t("pulls:gate.changeset")}</h3>
            <Link to={changesetPath(handle, pullNumber)} title={pullNumber}><code>{pullNumber.slice(0, 12)}</code></Link>
            {activeRevision && <dl>
              <div><dt>{t("pulls:gate.currentRevision")}</dt><dd>{t("pulls:gate.revisionNumber", { number: changeset.changeset.revisions.length })}</dd></div>
              <div><dt>{t("pulls:gate.commit")}</dt><dd><code title={activeRevision.commit_sha}>{activeRevision.commit_sha.slice(0, 7)}</code></dd></div>
              <div><dt>{t("pulls:gate.evidence")}</dt><dd><Link className={`checks-${evidenceStatus}`} to={pullRequestPath(handle, repository, pullNumber, "checks")}>{t(`pulls:gate.evidenceStatus.${evidenceStatus}`)}</Link></dd></div>
            </dl>}
            {canWrite && (state === "open" || state === "draft") && <Button disabled={actionBusy} onClick={() => void run(() => changesetAPI.addRevision(organization.id, pullNumber, pr.source_branch))}>{t("pulls:actions.refresh")}</Button>}
          </section>
          <section className="pull-reviewers">
            <h3>{t("pulls:sidebar.reviewers")}</h3>
            {review ? <div className="pull-reviewer-status"><strong>{memberName(review.reviewer)}</strong>
              <span className={review.status === "approved" ? "checks-passed" : undefined}>
                {review.status === "approved" && <CircleCheck size={15} aria-hidden="true"/>}{t(`pulls:review.${review.status}`)}
              </span></div> : <p>{t("pulls:sidebar.noReviewers")}</p>}
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
          </section>
        </aside>
      </div>}
      {tab === "commits" && currentComparison?.data && (
        <PullRequestCommitsTab commits={currentComparison.data.commits} truncated={currentComparison.data.commits_truncated}/>
      )}
      {tab === "checks" && (
        <PullRequestChecksTab
          activeRevision={activeRevision}
          activeEvaluation={activeEvaluation}
          activeEvidence={activeEvidence}
          canEvaluate={canWrite && !actionBusy && state !== "merged" && state !== "closed" && !!activeRevision}
          onEvaluate={() => void run(() => changesetAPI.evaluate(organization.id, pullNumber))}
        />
      )}
      {tab === "files" && files && (
        <PullRequestFilesTab
          key={revisionKey}
          files={files}
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
