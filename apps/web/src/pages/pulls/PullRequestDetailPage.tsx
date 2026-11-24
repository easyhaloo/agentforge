import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, ChevronDown, CircleCheck, ClipboardCheck, CornerDownLeft, FileDiff, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Layers3, MessagesSquare, Pencil, TriangleAlert } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { changesetAPI, repositoryAPI, type RepositorySettings, type PullRequestMergeMethod, type OrganizationSummary, type StoredChangeset, type PullRequestComparison, type PullRequestRequiredWorkflows, type PullBranchMethod, organizationAPI, type OrganizationMember } from "../../shared/api/identity";
import { APIError, translateError } from "../../shared/api/errors";
import { changesetPath, orgPath, pullRequestPath, repositoryPath, type PullRequestTab } from "../../shared/routing";
import { Button, Checkbox, Input, Popover, Select, Tabs, type TabsItem, ConfirmDialog } from "../../shared/ui";
import { parseRepositoryDiff } from "../repositories/repositoryDiff";
import { PullRequestConversationTab } from "./PullRequestConversationTab";
import { PullRequestCommitsTab } from "./PullRequestCommitsTab";
import { PullRequestChecksTab } from "./PullRequestChecksTab";
import { PullRequestIssueLinks } from "./PullRequestIssueLinks";
import { PullRequestProjects } from "./PullRequestProjects";
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
type WorkflowResult = { key: string } & (
  ({ status: "loaded" } & Omit<PullRequestRequiredWorkflows, "revision_id">) | { status: "stale" | "unavailable" }
);

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
  const updateChangeset = (next: StoredChangeset) => setChangeset(current =>
    current?.changeset.id === next.changeset.id && current.version > next.version ? current : next);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");
  const [stageError, setStageError] = useState("");
  const [draftConfirm, setDraftConfirm] = useState(false);
  const stageBadge = useRef<HTMLSpanElement>(null);
  const restoreStageFocus = useRef(false);
  const [titleDraft, setTitleDraft] = useState<{ value: string; version: number }>();
  const [titleError, setTitleError] = useState("");
  const restoreTitleFocus = useRef(false);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [reviewerID, setReviewerID] = useState("");
  const [mergeConfirmKey, setMergeConfirmKey] = useState<string>();
  const [mergePolicy, setMergePolicy] = useState<{ key: string; settings?: RepositorySettings }>();
  const [mergePolicyRetry, setMergePolicyRetry] = useState(0);
  const [mergeMethod, setMergeMethod] = useState<PullRequestMergeMethod>();
  const [mergeError, setMergeError] = useState("");
  const [comparison, setComparison] = useState<{ revisionKey: string; data?: PullRequestComparison; error?: string }>();
  const [comparisonRetry, setComparisonRetry] = useState(0);
  const [workflowResult, setWorkflowResult] = useState<WorkflowResult>();
  const [branchDraft, setBranchDraft] = useState<{ revision: string; base: string; method: PullBranchMethod; signoff: boolean }>();
  const [branchError, setBranchError] = useState<{ key: string; message: string }>();
  const [branchUpdating, setBranchUpdating] = useState(false);
  const [workflowRetry, setWorkflowRetry] = useState(0);
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

  const mergeReady = current?.status === "ready_to_merge";
  const baseBranch = current?.changeset.pull_request?.base_branch;
  const revisionID = activeRevision?.id;
  const state = current && pullRequestState(current);
  const activePull = state === "open" || state === "draft";
  useEffect(() => {
    setStageError("");
    setDraftConfirm(false);
    if (restoreStageFocus.current) {
      restoreStageFocus.current = false;
      stageBadge.current?.focus();
    }
  }, [state, organization.id, pullNumber]);
  const workflowKey = `${revisionKey}/${baseBranch}/${state}/${workflowRetry}`;
  const workflow = workflowResult?.key === workflowKey ? workflowResult : undefined;
  useEffect(() => {
    if (loading || !revisionID) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const { revision_id, checks, branch_update } = await changesetAPI.getRequiredWorkflows(organization.id, pullNumber, controller.signal);
        if (controller.signal.aborted) return;
        if (revision_id !== revisionID) {
          setMergeConfirmKey(undefined);
          setWorkflowResult({ key: workflowKey, status: "stale" });
          return;
        }
        if (checks.some(check => check.status !== "passed")) setMergeConfirmKey(undefined);
        setWorkflowResult({ key: workflowKey, status: "loaded", checks, branch_update });
        if (activePull && (checks.length > 0 || branch_update)) timer = setTimeout(refresh, 5000);
      } catch {
        if (!controller.signal.aborted) {
          setMergeConfirmKey(undefined);
          setWorkflowResult({ key: workflowKey, status: "unavailable" });
        }
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [organization.id, pullNumber, revisionID, workflowKey, loading, activePull]);

  const mergePolicyKey = `${revisionKey}/${baseBranch}/${mergePolicyRetry}`;
  const activeMergePolicy = mergePolicy?.key === mergePolicyKey ? mergePolicy : undefined;
  useEffect(() => {
    if (!mergeReady || !baseBranch) return;
    const controller = new AbortController();
    void repositoryAPI.settings(organization.id, repository, controller.signal, baseBranch)
      .then(settings => { if (!controller.signal.aborted) setMergePolicy({ key: mergePolicyKey, settings }); })
      .catch(() => { if (!controller.signal.aborted) setMergePolicy({ key: mergePolicyKey }); });
    return () => controller.abort();
  }, [organization.id, repository, mergeReady, baseBranch, mergePolicyKey]);

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
    reportError: (message: string) => void = setError,
    conflictKey?: string,
  ) => {
    setActionBusy(true); reportError("");
    try {
      setChangeset(await action());
      return true;
    } catch (cause) {
      reportError(conflictKey && cause instanceof APIError && cause.status === 409
        ? t(conflictKey) : translateError(cause, t, errorKey));
      return false;
    }
    finally { setActionBusy(false); }
  };
  const updateState = async (action: "ready" | "draft" | "close" | "reopen") => {
    if (actionBusy) return;
    const stageChange = action === "ready" || action === "draft";
    setStageError("");
    if (stageChange) restoreStageFocus.current = true;
    const updated = await run(
      () => changesetAPI.updatePullRequestState(organization.id, pullNumber, action),
      "pulls:actions.stateChangeFailed",
      stageChange ? setStageError : setLifecycleError,
    );
    if (!updated && stageChange) restoreStageFocus.current = false;
  };

  if (loading) return <div className="org-loading">{t("pulls:detail.loading")}</div>;
  if (!current || !changeset || !state) return <div className="org-error" role="alert">{error || t("pulls:detail.loadFailed")}</div>;

  const pr = changeset.changeset.pull_request!;
  const canWrite = organization.role !== "viewer";
  const branchUpdate = canWrite && activePull && workflow?.status === "loaded" ? workflow.branch_update : undefined;
  const branchChoice = branchDraft && branchUpdate && branchDraft.revision === revisionID && branchDraft.base === branchUpdate.base_sha ? branchDraft : undefined;
  const branchMethod = branchChoice && branchUpdate?.methods.includes(branchChoice.method) ? branchChoice.method : branchUpdate?.methods[0];
  const branchSignoff = branchChoice?.signoff ?? false;
  const branchKey = `${revisionKey}/${branchUpdate?.base_sha}`;
  const setBranchChoice = (method: PullBranchMethod, signoff: boolean) => {
    if (revisionID && branchUpdate) setBranchDraft({ revision: revisionID, base: branchUpdate.base_sha, method, signoff });
  };
  const updateBranch = async () => {
    if (actionBusy || !revisionID || !branchUpdate || !branchMethod || (branchUpdate.signoff_required && !branchSignoff)) return;
    setBranchUpdating(true);
    try {
      const updated = await run(() => changesetAPI.updatePullBranch(organization.id, pullNumber, {
        revision_id: revisionID, base_sha: branchUpdate.base_sha, method: branchMethod, signoff: branchUpdate.signoff_required && branchSignoff,
      }), "pulls:branchUpdate.failed", message => setBranchError(message ? { key: revisionKey, message } : undefined));
      if (updated) setBranchDraft(undefined);
    } finally { setBranchUpdating(false); }
  };
  const canManage = canWrite && (changeset.changeset.created_by === userID || ["owner", "admin"].includes(organization.role));
  const currentTitle = changeset.changeset.title;
  const editedTitle = titleDraft?.value.trim() ?? "";
  const titleTooLong = [...editedTitle].length > 200;
  const titleIssue = titleTooLong ? t("pulls:detail.titleTooLong", { max: 200 }) : titleError;
  const finishTitleEdit = () => {
    restoreTitleFocus.current = true;
    setTitleDraft(undefined);
    setTitleError("");
  };
  const saveTitle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (actionBusy || !titleDraft || !editedTitle || titleTooLong || editedTitle === currentTitle) return;
    const saved = await run(
      () => changesetAPI.updatePullRequestTitle(organization.id, pullNumber, editedTitle, titleDraft.version),
      "pulls:detail.titleSaveFailed", setTitleError, "pulls:detail.titleConflict",
    );
    if (saved) finishTitleEdit();
  };
  const lifecycleAction = canManage && state !== "merged" ? (state === "closed" ? "reopen" : "close") : undefined;
  const canMerge = canWrite && state === "open" && mergeReady;
  const mergeSettings = activeMergePolicy?.settings;
  const mergeMethods = mergeSettings?.pull_request_merge_methods ?? [];
  const method = mergeMethod && mergeMethods.includes(mergeMethod) ? mergeMethod : mergeMethods[0];
  const hasMethod = mergeSettings?.hosting_kind === "registered" || method !== undefined;
  const checks = workflow?.status === "loaded" ? workflow.checks : [];
  const passedChecks = checks.filter(check => check.status === "passed").length;
  const workflowsAllowMerge = workflow?.status === "loaded" && passedChecks === checks.length;
  const workflowSummary = workflow?.status === "loaded"
    ? checks.length > 0 && t("pulls:requiredWorkflows.summary", { passed: passedChecks, total: checks.length })
    : t(`pulls:requiredWorkflows.${workflow?.status ?? "loading"}`);
  const workflowNeedsRetry = workflow?.status === "stale" || workflow?.status === "unavailable";
  const retryWorkflows = () => {
    setWorkflowRetry(attempt => attempt + 1);
    if (workflow?.status === "stale") void load();
  };
  const queueRequired = mergeSettings?.default_branch === pr.base_branch &&
    mergeSettings.ref_rules?.some(rule => rule.enabled && rule.require_merge_queue);
  const conversationsBlockMerge = mergeSettings?.pull_request_requires_conversation_resolution &&
    pr.comments.some(comment => comment.revision_id && !(comment.resolved_at && comment.resolved_by));
  const mergeEnabled = canMerge && !queueRequired && hasMethod && workflowsAllowMerge && !conversationsBlockMerge && !actionBusy;
  const queueSearch = new URLSearchParams({ queueRepository: repository, queueTarget: pr.base_branch, queueSource: pr.source_branch });
  const StateIcon = stateIcons[state];
  const stateClass = `pull-state pull-state-${state}`;
  const stateLabel = <><StateIcon size={16} aria-hidden="true"/>{t(`pulls:state.${state}`)}</>;
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
    setMergeConfirmKey(undefined);
    if (!mergeEnabled || mergeConfirmKey !== workflowKey) return;
    if (!await run(() => changesetAPI.merge(organization.id, pullNumber, pr.base_branch, method), "pulls:actions.mergeFailed", setMergeError)) {
      setMergePolicyRetry(attempt => attempt + 1);
      retryWorkflows();
    }
  };
  const tabs: TabsItem[] = [
    { key: "conversation", icon: MessagesSquare, count: pr.comments.length },
    { key: "commits", icon: GitCommitHorizontal, count: commitCount },
    { key: "checks", icon: ClipboardCheck, count: checks.length + (activeEvaluation ? 1 : 0) },
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
      {canManage && titleDraft ? (
        <form className="pull-request-title-form" onSubmit={saveTitle} onKeyDown={event => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing && !actionBusy) {
            event.preventDefault();
            finishTitleEdit();
          }
        }}>
          <Input aria-label={t("pulls:create.titleLabel")} value={titleDraft.value} autoFocus readOnly={actionBusy}
            error={titleIssue && <span role="alert">{titleIssue}</span>}
            onChange={event => {
              setTitleDraft({ ...titleDraft, value: event.target.value });
              setTitleError("");
            }}/>
          <div className="pull-request-actions">
            <Button onClick={finishTitleEdit} disabled={actionBusy}>{t("common:actions.cancel")}</Button>
            <Button type="submit" variant="primary" loading={actionBusy}
              disabled={!editedTitle || titleTooLong || editedTitle === currentTitle}>
              {t("common:actions.save")} <CornerDownLeft size={14} aria-hidden="true"/>
            </Button>
          </div>
        </form>
      ) : <div className="pull-request-title-row">
        <div className="pull-request-title">
          <h1>{currentTitle}</h1>
          {canManage && <Button variant="ghost" className="pull-request-title-edit" disabled={actionBusy}
            aria-label={t("pulls:detail.editTitle")} title={t("pulls:detail.editTitle")}
            ref={button => {
              if (button && restoreTitleFocus.current) {
                restoreTitleFocus.current = false;
                button.focus();
              }
            }} onClick={() => setTitleDraft({ value: currentTitle, version: changeset.version })}>
            <Pencil size={16} aria-hidden="true"/>
          </Button>}
        </div>
      </div>}
      <div className="pull-request-meta">
        <span ref={stageBadge} tabIndex={-1} className={stateClass}>{stateLabel}</span>
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
          onUpdate={updateChangeset}
          memberName={memberName}
          lifecycleAction={lifecycleAction}
          lifecycleError={lifecycleError}
          onLifecycleAction={updateState}
          actionBusy={actionBusy}
        >
          <section className="pull-merge-gate" aria-label={t("pulls:gate.mergeTitle")}>
            {state !== "draft" && <div className="pull-merge-gate-main">
              <GitMerge size={20} aria-hidden="true"/>
              <div>
                <h3>{state === "merged" ? t("pulls:gate.merged") : t("pulls:gate.mergeTitle")}</h3>
                {state === "merged" && changeset.changeset.merge ? <code title={changeset.changeset.merge.commit_sha}>{changeset.changeset.merge.commit_sha.slice(0, 12)}</code>
                  : canMerge ? conversationsBlockMerge ? <p role="status">{t("pulls:gate.conversationsRequired")}</p>
                    : workflowsAllowMerge && <p>{t(queueRequired ? "pulls:gate.queueRequired" : "pulls:gate.ready")}</p>
                  : <p>{state === "open" ? t("pulls:actions.mergeRequirements") : t(`pulls:state.${state}`)}</p>}
              </div>
            </div>}
            {activePull && activeRevision && workflowSummary && <div className="pull-workflow-summary">
              <span role="status">{workflowSummary}</span>
              <Link to={pullRequestPath(handle, repository, pullNumber, "checks")}>{t("pulls:requiredWorkflows.viewChecks")}</Link>
              {workflowNeedsRetry && <Button onClick={retryWorkflows}>{t("pulls:actions.retry")}</Button>}
            </div>}
            {branchUpdate && branchMethod && <div className="pull-gate-row">
              <div className="pull-merge-gate-main">
                <TriangleAlert size={20} aria-hidden="true"/>
                <div>
                  <h3>{t("pulls:branchUpdate.behind")}</h3>
                  <p>{t("pulls:branchUpdate.description", { base: pr.base_branch, source: pr.source_branch })}</p>
                </div>
              </div>
              <fieldset className="pull-branch-actions" key={branchKey} disabled={actionBusy}>
                <Button onClick={() => void updateBranch()} loading={branchUpdating}
                  disabled={actionBusy || (branchUpdate.signoff_required && !branchSignoff)}>
                  {t(branchUpdating ? "pulls:branchUpdate.updating" : "pulls:branchUpdate.update")}
                </Button>
                {branchUpdate.methods.length > 1 && <Popover ariaLabel={t("pulls:branchUpdate.method")}
                  trigger={<><ChevronDown size={14} aria-hidden="true"/><span className="pull-visually-hidden">{t("pulls:branchUpdate.method")}</span></>}>
                  {dismiss => branchUpdate.methods.map(value => <Button key={value} variant="ghost" aria-pressed={value === branchMethod}
                    aria-label={t(`pulls:branchUpdate.${value}`)} disabled={actionBusy} onClick={() => {
                      setBranchChoice(value, branchSignoff);
                      dismiss();
                    }}>
                    <Check size={16} aria-hidden="true" className={value === branchMethod ? undefined : "pull-option-unchecked"}/>
                    <span><strong>{t(`pulls:branchUpdate.${value}`)}</strong><small>{t(`pulls:branchUpdate.${value}Help`)}</small></span>
                  </Button>)}
                </Popover>}
              </fieldset>
              {branchUpdate.signoff_required && <div className="pull-gate-row-message">
                <Checkbox label={t("pulls:branchUpdate.signoff")} checked={branchSignoff} disabled={actionBusy}
                  onChange={event => setBranchChoice(branchMethod, event.target.checked)} />
              </div>}
            </div>}
            {branchError?.key === revisionKey && <p role="alert" className="org-error pull-gate-row-message">{branchError.message}</p>}
            {state === "draft" && <div className="pull-gate-row">
              <div className="pull-merge-gate-main">
                <GitPullRequestDraft size={20} aria-hidden="true"/>
                <div>
                  <h3>{t("pulls:gate.draftTitle")}</h3>
                  <p>{t("pulls:gate.draftHelp")}</p>
                </div>
              </div>
              {canManage && <Button disabled={actionBusy} onClick={() => void updateState("ready")}>{t("pulls:actions.markReady")}</Button>}
              {stageError && <p role="alert" className="org-error pull-gate-row-message">{stageError}</p>}
            </div>}
            {state === "draft" && <div className="pull-gate-row"><Button disabled>{t("pulls:actions.merge")}</Button></div>}
            {canMerge && (queueRequired
              ? workflowsAllowMerge && !conversationsBlockMerge && !actionBusy
                ? <Link to={`${orgPath(handle, "pipelines")}?${queueSearch}`}>{t("pulls:actions.openMergeQueue")}</Link>
                : <Button disabled>{t("pulls:actions.openMergeQueue")}</Button>
              : <div className="pull-merge-actions">
                {mergeMethods.length > 0 && <Select aria-label={t("pulls:actions.mergeMethod")} value={method}
                  disabled={!mergeEnabled} options={mergeMethods.map(value => ({ value, label: t(`pulls:actions.methods.${value}`) }))}
                  onChange={event => setMergeMethod(mergeMethods.find(value => value === event.target.value))} />}
                <Button variant="primary" onClick={() => setMergeConfirmKey(workflowKey)} disabled={!mergeEnabled}>{t("pulls:actions.merge")}</Button>
                {activeMergePolicy && !mergeSettings && <Button onClick={() => setMergePolicyRetry(attempt => attempt + 1)}>{t("pulls:actions.retry")}</Button>}
              </div>)}
            {canMerge && !queueRequired && !hasMethod && <p role="status">{t(!activeMergePolicy ? "pulls:actions.loadingMergeMethods"
              : mergeSettings ? "pulls:actions.noMergeMethods" : "pulls:actions.loadMergeMethodsFailed")}</p>}
            {mergeError && <p role="alert" className="org-error">{mergeError}</p>}
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
            {canWrite && (state === "open" || state === "draft") && <Button disabled={actionBusy} onClick={() => void run(() => changesetAPI.addRevision(organization.id, pullNumber, pr.source_branch))}>{t("pulls:actions.updateRevision")}</Button>}
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
            {canManage && state === "open" && <>
              <Button variant="ghost" className="pull-convert-draft" disabled={actionBusy} onClick={() => setDraftConfirm(true)}>{t("pulls:actions.markDraft")}</Button>
              {stageError && <p role="alert" className="org-error">{stageError}</p>}
            </>}
          </section>
          <PullRequestIssueLinks key={`${organization.id}/${repository}/${pullNumber}`} organization={organization}
            repository={repository} pullID={pullNumber} handle={handle} editable={state === "open" || state === "draft"} />
          <PullRequestProjects organization={organization} handle={handle} repository={repository} pullID={pullNumber} />
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
          requiredWorkflows={checks}
          workflowStatus={activeRevision && workflowSummary ? workflowSummary : undefined}
          onRetryWorkflows={workflowNeedsRetry ? retryWorkflows : undefined}
          canEvaluate={canWrite && !actionBusy && state !== "merged" && state !== "closed" && !!activeRevision}
          onEvaluate={() => void run(() => changesetAPI.evaluate(organization.id, pullNumber))}
        />
      )}
      {tab === "files" && files && (
        <PullRequestFilesTab
          key={revisionKey}
          files={files}
          memberName={memberName}
          organization={organization}
          changeset={changeset}
          pullNumber={pullNumber}
          onUpdate={updateChangeset}
        />
      )}
    </div>

    <ConfirmDialog
      open={canManage && state === "open" && draftConfirm}
      title={t("pulls:actions.markDraft")}
      description={t("pulls:actions.confirmDraft")}
      confirmText={t("pulls:actions.markDraft")}
      onCancel={() => setDraftConfirm(false)}
      onConfirm={async () => {
        await updateState("draft");
        setDraftConfirm(false);
      }}
    />
    <ConfirmDialog
      open={mergeEnabled && mergeConfirmKey === workflowKey}
      title={t("pulls:actions.merge")}
      description={method
        ? t("pulls:actions.confirmMergeMethod", { source: pr.source_branch, base: pr.base_branch, method: t(`pulls:actions.methods.${method}`) })
        : t("pulls:actions.confirmMerge", { source: pr.source_branch, base: pr.base_branch })}
      confirmText={t("pulls:actions.merge")}
      onConfirm={merge}
      onCancel={() => setMergeConfirmKey(undefined)}
    />
  </section>;
}
