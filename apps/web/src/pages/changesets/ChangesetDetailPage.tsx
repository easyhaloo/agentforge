import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { CheckCircle2, FileCheck2, GitBranch, GitMerge, Play, ShieldCheck } from "lucide-react";
import { changesetAPI, type OrganizationSummary, type StoredChangeset } from "../../shared/api/identity";
import { changesetPath, changesetTabs, organizationHandle, orgPath, type ChangesetTab } from "../../shared/routing";
import { Button, Input } from "../../shared/ui";
import { changesetLifecycleSteps, changesetReviewRefusal, changesetStatusClass, changesetStatusLabels, completedLifecycleSteps } from "./changeset-status";

type Props = {
  organization: OrganizationSummary;
  accountUserID: string;
  changesetID: string;
  tab: ChangesetTab;
  onNotify: (message: string) => void;
};

const tabLabels: Record<ChangesetTab, string> = {
  overview: "Overview",
  revisions: "Revisions",
  evaluation: "Evaluation",
  review: "Review",
  merge: "Merge",
};

/**
 * The changeset detail page. Every part of the lifecycle is a route, so each one can be linked to.
 * The server owns the status and the merge gate, so the buttons follow the status it reports
 * instead of deriving the lifecycle in the browser (ADR-003).
 */
export function ChangesetDetailPage({ organization, accountUserID, changesetID, tab, onNotify }: Props) {
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
      setError(cause instanceof Error ? cause.message : "Unable to load the changeset");
    } finally { setLoading(false); }
  }, [organization.id, changesetID]);
  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<StoredChangeset>, message: string) => {
    setBusy(true); setError("");
    try {
      setItem(await action());
      onNotify(message);
    } catch (cause) {
      // The server explains why it refused (409 "revision is not current", 409 "Review already approved").
      setError(cause instanceof Error ? cause.message : "Delivery operation failed");
    } finally { setBusy(false); }
  };

  if (loading) return <section className="changeset-detail card"><div className="org-loading">Loading changeset…</div></section>;
  if (!item) return <section className="changeset-detail card">
    <div className="org-error" role="alert">{error || "This changeset could not be loaded."}</div>
    <Link className="button secondary" to={orgPath(handle, "changesets")}>Back to changesets</Link>
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
    <nav className="changeset-tabs" aria-label="Changeset sections">
      {changesetTabs.map(name => <NavLink key={name} to={changesetPath(handle, changeset.id, name)} end={name === "overview"} className={({ isActive }) => `changeset-tab${isActive ? " is-active" : ""}`}>{tabLabels[name]}</NavLink>)}
    </nav>
    <section className="changeset-detail card">
      <div className="changeset-detail__head">
        <div>
          <h3>{changeset.title}</h3>
          <p>{changeset.repository} · Created by {changeset.created_by}</p>
        </div>
        <span className={changesetStatusClass(changesetStatusLabels[item.status])}>{changesetStatusLabels[item.status]}</span>
      </div>
      {error && <div className="org-error" role="alert">{error}</div>}
      {tab === "overview" && <>
        <div className="changeset-steps">
          {changesetLifecycleSteps.map((step, index) => <div key={step} className={index > 0 && index <= completed ? "is-complete" : ""}><span>{index + 1}</span><b>{step}</b></div>)}
        </div>
        <div className="changeset-workflow">
          <div><label><GitBranch size={14}/> Current revision</label><p>{revision ? `${revision.ref} · ${revision.commit_sha}` : "No revision yet."}</p><span className="org-role">{revision ? new Date(revision.created_at).toLocaleString() : "Resolve a Git ref to start"}</span></div>
          <div><label><ShieldCheck size={14}/> Reviewer</label><p>{review ? `${review.reviewer} · ${review.status}` : "No review assigned yet."}</p><span className="org-role">{review?.comment || "A review can be asked for once the evidence is current"}</span></div>
        </div>
        {changeset.audit.length > 0 && <div className="changeset-audit"><h4>Lifecycle audit</h4>{changeset.audit.slice().reverse().map(event => <div key={event.sequence}><span>{event.operation}</span><small>{event.actor} · {new Date(event.at).toLocaleString()}</small></div>)}</div>}
      </>}
      {tab === "revisions" && <>
        <div className="changeset-workflow">
          <form onSubmit={event => { event.preventDefault(); void run(() => changesetAPI.addRevision(organization.id, changeset.id, revisionRef), "Git revision resolved and persisted."); setRevisionRef(""); }}>
            <div><label><GitBranch size={14}/> Resolve Git ref</label><Input required value={revisionRef} onChange={event => setRevisionRef(event.target.value)} placeholder="branch, tag or commit SHA"/></div>
            <Button className="button secondary" type="submit" disabled={busy || !canAddRevision}>Add revision</Button>
          </form>
          <div><label><GitBranch size={14}/> Revisions</label><p>{changeset.revisions.length ? changeset.revisions.map(entry => `${entry.ref} · ${entry.commit_sha}`).join(", ") : "No revision yet."}</p><span className="org-role">{revision ? "The current revision" : "Resolve a Git ref to start"}</span></div>
        </div>
      </>}
      {tab === "evaluation" && <>
        <div className="changeset-workflow">
          <div><label><Play size={14}/> Trusted evaluation</label><p>{evaluation ? evaluation.summary : "No evaluation for the current revision."}</p><Button className="button secondary" disabled={busy || !canEvaluate} onClick={() => void run(() => changesetAPI.evaluate(organization.id, changeset.id), "Trusted evaluation completed.")}>Run evaluation</Button></div>
          <div><label><FileCheck2 size={14}/> Evidence provenance</label><p>{activeEvidence ? changeset.evidence.filter(value => value.revision_id === revision?.id && value.status === "active").map(value => value.sha256 || value.uri).join(", ") : "Evidence is generated automatically from a passing evaluation report."}</p><span className="org-role">{activeEvidence ? "Verified artifact" : "Awaiting passing evaluation"}</span></div>
        </div>
      </>}
      {tab === "review" && <>
        <div className="changeset-workflow">
          <form onSubmit={event => { event.preventDefault(); void run(() => changesetAPI.assignReview(organization.id, changeset.id, reviewerID, reviewComment), "Review assigned to an active organization member."); setReviewerID(""); setReviewComment(""); }}>
            <div><label><ShieldCheck size={14}/> Assign review (active member ID)</label><Input required value={reviewerID} onChange={event => setReviewerID(event.target.value)} placeholder="reviewer user ID"/><Input value={reviewComment} onChange={event => setReviewComment(event.target.value)} placeholder="Review context (optional)"/></div>
            <Button className="button secondary" type="submit" title={canAssignReview ? undefined : changesetReviewRefusal(item.status)} disabled={busy || !canAssignReview}>Assign review</Button>
            {!canAssignReview && <p className="changeset-hint">{changesetReviewRefusal(item.status)}</p>}
          </form>
          {review && <div><label><ShieldCheck size={14}/> Review decision</label><p>Assigned to {review.reviewer} · {review.status}{review.comment ? " · " + review.comment : ""}</p>{review.reviewer === accountUserID && review.status === "pending" && <div className="org-actions"><Button className="button secondary" disabled={busy} onClick={() => void run(() => changesetAPI.decideReview(organization.id, changeset.id, review.id, true, decisionComment), "Review approved.")}>Approve</Button><Button className="button secondary" disabled={busy} onClick={() => void run(() => changesetAPI.decideReview(organization.id, changeset.id, review.id, false, decisionComment), "Changes requested.")}>Request changes</Button></div>}<Input value={decisionComment} onChange={event => setDecisionComment(event.target.value)} placeholder="Decision comment"/></div>}
        </div>
      </>}
      {tab === "merge" && <>
        <div className="changeset-workflow">
          <form onSubmit={event => { event.preventDefault(); void run(() => changesetAPI.merge(organization.id, changeset.id, targetRef), "Git merge completed and persisted."); }}>
            <div><label><GitMerge size={14}/> Merge target</label><Input required value={targetRef} onChange={event => setTargetRef(event.target.value)} placeholder="main"/></div>
            <Button className="button primary" type="submit" disabled={busy || !canMerge}>Merge changeset</Button>
          </form>
        </div>
        {changeset.merge && <div className="changeset-merge-result"><CheckCircle2 size={15}/> Merged as <code>{changeset.merge.commit_sha}</code> into {changeset.merge.target_ref}</div>}
      </>}
    </section>
  </>;
}
