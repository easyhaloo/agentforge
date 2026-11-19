import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { CheckCircle2, FileCheck2, GitBranch, GitMerge, Play, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { changesetAPI, type OrganizationSummary, type StoredChangeset } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { formatDateTime } from "../../shared/i18n/format";
import { changesetPath, changesetTabs, organizationHandle, orgPath, type ChangesetTab } from "../../shared/routing";
import { Button, Input } from "../../shared/ui";
import { auditEntryLabel, changesetLifecycleSteps, changesetLifecycleStepLabel, changesetReviewRefusal, changesetStatusClass, changesetStatusLabel, completedLifecycleSteps, reviewStatusLabel } from "./changeset-status";

type Props = {
  organization: OrganizationSummary;
  accountUserID: string;
  changesetID: string;
  tab: ChangesetTab;
  onNotify: (message: string) => void;
};

/**
 * The changeset detail page. Every part of the lifecycle is a route, so each one can be linked to.
 * The server owns the status and the merge gate, so the buttons follow the status it reports
 * instead of deriving the lifecycle in the browser (ADR-003).
 */
export function ChangesetDetailPage({ organization, accountUserID, changesetID, tab, onNotify }: Props) {
  const { t } = useTranslation();
  const { org } = useParams();
  const handle = org || organizationHandle(organization);
  const [item, setItem] = useState<StoredChangeset | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revisionRef, setRevisionRef] = useState("");
  const [reviewerID, setReviewerID] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [targetRef, setTargetRef] = useState("main");
  const [decisionComment, setDecisionComment] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      setItem(await changesetAPI.get(organization.id, changesetID));
    } catch (cause) {
      setItem(null);
      setError(translateError(cause, t, "changesets:errors.detailLoadFailed"));
    } finally { setLoading(false); }
  }, [organization.id, changesetID, t]);
  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<StoredChangeset>, message: string) => {
    setBusy(true); setError("");
    try {
      setItem(await action());
      onNotify(message);
    } catch (cause) {
      // The server explains why it refused (409 "revision is not current", 409 "Review already approved").
      setError(translateError(cause, t, "changesets:errors.operationFailed"));
    } finally { setBusy(false); }
  };

  if (loading) return <section className="changeset-detail card"><div className="org-loading">{t("changesets:detail.loading")}</div></section>;
  if (!item) return <section className="changeset-detail card">
    <div className="org-error" role="alert">{error || t("changesets:errors.detailLoadFailed")}</div>
    <Link className="button secondary" to={orgPath(handle, "changesets")}>{t("changesets:detail.backToList")}</Link>
  </section>;

  const changeset = item.changeset;
  const revision = changeset.revisions.slice(-1)[0];
  const evaluation = revision && changeset.evaluations.filter(value => value.revision_id === revision.id).slice(-1)[0];
  const review = revision && changeset.reviews.filter(value => value.revision_id === revision.id).slice(-1)[0];
  const activeEvidence = !!(revision && changeset.evidence.some(value => value.revision_id === revision.id && value.status === "active"));
  const completed = completedLifecycleSteps(item.status);
  // Every gate below is the server's answer: the status says what may still happen.
  const canAddRevision = item.status !== "merged";
  const canEvaluate = item.status !== "draft" && item.status !== "merged";
  const canAssignReview = item.status === "review_required" || item.status === "in_review" || item.status === "changes_requested";
  const canMerge = item.status === "ready_to_merge";

  return <>
    <nav className="changeset-tabs" aria-label={t("changesets:detail.sectionsAriaLabel")}>
      {changesetTabs.map(name => <NavLink key={name} to={changesetPath(handle, changeset.id, name)} end={name === "overview"} className={({ isActive }) => `changeset-tab${isActive ? " is-active" : ""}`}>{t(`changesets:tabs.${name}`)}</NavLink>)}
    </nav>
    <section className="changeset-detail card">
      <div className="changeset-detail__head">
        <div>
          <h3>{changeset.title}</h3>
          <p>{t("changesets:detail.createdBy", { repository: changeset.repository, actor: changeset.created_by })}</p>
        </div>
        <span className={changesetStatusClass(item.status)}>{changesetStatusLabel(item.status, t)}</span>
      </div>
      {error && <div className="org-error" role="alert">{error}</div>}
      {tab === "overview" && <>
        <div className="changeset-steps">
          {changesetLifecycleSteps.map((step, index) => <div key={step} className={index > 0 && index <= completed ? "is-complete" : ""}><span>{index + 1}</span><b>{changesetLifecycleStepLabel(step, t)}</b></div>)}
        </div>
        <div className="changeset-workflow">
          <div><label><GitBranch size={14}/> {t("changesets:detail.currentRevision")}</label><p>{revision ? `${revision.ref} · ${revision.commit_sha}` : t("changesets:detail.noRevision")}</p><span className="org-role">{revision ? formatDateTime(revision.created_at) : t("changesets:detail.resolveRefToStart")}</span></div>
          <div><label><ShieldCheck size={14}/> {t("changesets:detail.reviewer")}</label><p>{review ? `${review.reviewer} · ${reviewStatusLabel(review.status, t)}` : t("changesets:detail.noReviewAssigned")}</p><span className="org-role">{review?.comment || t("changesets:reviewRefusal.default")}</span></div>
        </div>
        {changeset.audit.length > 0 && <div className="changeset-audit"><h4>{t("changesets:detail.auditTitle")}</h4>{changeset.audit.slice().reverse().map(event => <div key={event.sequence}><span>{auditEntryLabel(event.operation, event.outcome, t)}</span><small>{t("changesets:detail.auditEntry", { actor: event.actor, at: formatDateTime(event.at) })}</small></div>)}</div>}
      </>}
      {tab === "revisions" && <>
        <div className="changeset-workflow">
          <form onSubmit={event => { event.preventDefault(); void run(() => changesetAPI.addRevision(organization.id, changeset.id, revisionRef), t("changesets:notify.revisionResolved")); setRevisionRef(""); }}>
            <div><label><GitBranch size={14}/> {t("changesets:detail.resolveRefLabel")}</label><Input required value={revisionRef} onChange={event => setRevisionRef(event.target.value)} placeholder={t("changesets:detail.refPlaceholder")}/></div>
            <Button className="button secondary" type="submit" disabled={busy || !canAddRevision}>{t("changesets:detail.addRevisionButton")}</Button>
          </form>
          <div><label><GitBranch size={14}/> {t("changesets:detail.revisionsTitle")}</label><p>{changeset.revisions.length ? changeset.revisions.map(entry => `${entry.ref} · ${entry.commit_sha}`).join(", ") : t("changesets:detail.noRevision")}</p><span className="org-role">{revision ? t("changesets:detail.currentRevisionBadge") : t("changesets:detail.resolveRefToStart")}</span></div>
        </div>
      </>}
      {tab === "evaluation" && <>
        <div className="changeset-workflow">
          <div><label><Play size={14}/> {t("changesets:detail.evaluationTitle")}</label><p>{evaluation ? evaluation.summary : t("changesets:detail.evaluationEmpty")}</p><Button className="button secondary" disabled={busy || !canEvaluate} onClick={() => void run(() => changesetAPI.evaluate(organization.id, changeset.id), t("changesets:notify.evaluationCompleted"))}>{t("changesets:detail.runEvaluationButton")}</Button></div>
          <div><label><FileCheck2 size={14}/> {t("changesets:detail.evidenceTitle")}</label><p>{activeEvidence ? changeset.evidence.filter(value => value.revision_id === revision?.id && value.status === "active").map(value => value.sha256 || value.uri).join(", ") : t("changesets:detail.evidencePending")}</p><span className="org-role">{activeEvidence ? t("changesets:detail.evidenceVerified") : t("changesets:detail.evidenceAwaiting")}</span></div>
        </div>
      </>}
      {tab === "review" && <>
        <div className="changeset-workflow">
          <form onSubmit={event => { event.preventDefault(); void run(() => changesetAPI.assignReview(organization.id, changeset.id, reviewerID, reviewComment), t("changesets:notify.reviewAssigned")); setReviewerID(""); setReviewComment(""); }}>
            <div><label><ShieldCheck size={14}/> {t("changesets:detail.assignReviewLabel")}</label><Input required value={reviewerID} onChange={event => setReviewerID(event.target.value)} placeholder={t("changesets:detail.reviewerPlaceholder")}/><Input value={reviewComment} onChange={event => setReviewComment(event.target.value)} placeholder={t("changesets:detail.reviewCommentPlaceholder")}/></div>
            <Button className="button secondary" type="submit" title={canAssignReview ? undefined : changesetReviewRefusal(item.status, t)} disabled={busy || !canAssignReview}>{t("changesets:detail.assignReviewButton")}</Button>
            {!canAssignReview && <p className="changeset-hint">{changesetReviewRefusal(item.status, t)}</p>}
          </form>
          {review && <div><label><ShieldCheck size={14}/> {t("changesets:detail.reviewDecisionTitle")}</label><p>{t("changesets:detail.reviewAssigned", { reviewer: review.reviewer, status: reviewStatusLabel(review.status, t) })}{review.comment ? " · " + review.comment : ""}</p>{review.reviewer === accountUserID && review.status === "pending" && <div className="org-actions"><Button className="button secondary" disabled={busy} onClick={() => void run(() => changesetAPI.decideReview(organization.id, changeset.id, review.id, true, decisionComment), t("changesets:notify.reviewApproved"))}>{t("changesets:detail.approveButton")}</Button><Button className="button secondary" disabled={busy} onClick={() => void run(() => changesetAPI.decideReview(organization.id, changeset.id, review.id, false, decisionComment), t("changesets:notify.changesRequested"))}>{t("changesets:detail.requestChangesButton")}</Button></div>}<Input value={decisionComment} onChange={event => setDecisionComment(event.target.value)} placeholder={t("changesets:detail.decisionPlaceholder")}/></div>}
        </div>
      </>}
      {tab === "merge" && <>
        <div className="changeset-workflow">
          <form onSubmit={event => { event.preventDefault(); void run(() => changesetAPI.merge(organization.id, changeset.id, targetRef), t("changesets:notify.mergeCompleted")); }}>
            <div><label><GitMerge size={14}/> {t("changesets:detail.mergeTargetLabel")}</label><Input required value={targetRef} onChange={event => setTargetRef(event.target.value)} placeholder="main"/></div>
            <Button className="button primary" type="submit" disabled={busy || !canMerge}>{t("changesets:detail.mergeButton")}</Button>
          </form>
        </div>
        {changeset.merge && <div className="changeset-merge-result"><CheckCircle2 size={15}/> {t("changesets:detail.mergedAs", { commit: changeset.merge.commit_sha, ref: changeset.merge.target_ref })}</div>}
      </>}
    </section>
  </>;
}
