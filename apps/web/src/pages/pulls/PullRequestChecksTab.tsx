import { CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui";
import type { StoredChangeset } from "../../shared/api/identity";

type Props = {
  changeset: StoredChangeset;
  onEvaluate: () => void;
  canEvaluate: boolean;
  activeRevision: StoredChangeset["changeset"]["revisions"][number];
};

export function PullRequestChecksTab({ changeset, activeRevision, onEvaluate, canEvaluate }: Props) {
  const { t } = useTranslation(["pulls", "changesets"]);

  const activeEvaluation = changeset.changeset.evaluations.slice().reverse().find(e => e.revision_id === activeRevision?.id);
  const activeEvidence = changeset.changeset.evidence.filter(e => e.revision_id === activeRevision?.id && e.evaluation_id === activeEvaluation?.id && e.status === "active");

  const hasChecks = !!activeEvaluation;
  const allPassed = activeEvaluation?.status === "passed";
  const someFailed = activeEvaluation?.status === "failed";

  let statusIcon = <Clock size={20}/>;
  let statusText = t("pulls:checks.pending");
  let statusClass = "checks-pending";

  if (someFailed) {
    statusIcon = <XCircle size={20}/>;
    statusText = t("pulls:checks.failed");
    statusClass = "checks-failed";
  } else if (allPassed && activeEvidence.length > 0) {
    statusIcon = <CheckCircle2 size={20}/>;
    statusText = t("pulls:checks.passed");
    statusClass = "checks-passed";
  } else if (activeEvaluation && activeEvidence.length === 0) {
    statusIcon = <AlertTriangle size={20}/>;
    statusText = t("pulls:checks.required");
    statusClass = "checks-required";
  }

  return <div className="pull-checks-tab card">
    <div className="pull-checks-header">
      <h3>{t("pulls:checks.title")}</h3>
      <Button disabled={!canEvaluate} onClick={onEvaluate}>{t("changesets:detail.runEvaluationButton")}</Button>
      {activeRevision && <p>{t("pulls:checks.forRevision", { revision: activeRevision.id.slice(0, 7) })}</p>}
    </div>

    {!hasChecks ? (
      <div className="checks-empty">
        <AlertTriangle size={22}/>
        <p>{t("pulls:checks.noChecks")}</p>
      </div>
    ) : (
      <>
        <div className={`checks-status ${statusClass}`}>
          {statusIcon}
          <span>{statusText}</span>
        </div>

        {activeEvaluation && (
          <div className="checks-evaluation">
            <h4>{t("changesets:detail.evaluationTitle")}</h4>
            <div className="evaluation-item">
              <span className={`evaluation-status evaluation-status-${activeEvaluation.status}`}>
                {t(`pulls:checks.status.${activeEvaluation.status}`)}
              </span>
              <p>{activeEvaluation.summary}</p>
            </div>
          </div>
        )}

        {activeEvidence.length > 0 && (
          <div className="checks-evidence">
            <h4>{t("changesets:detail.evidenceTitle")}</h4>
            <div className="evidence-list">
              {activeEvidence.map(e => (
                <div key={e.id} className="evidence-item">
                  <span className={`evidence-status evidence-status-${e.status}`}>
                    {e.status === "active" ? <CheckCircle2 size={16}/> : <Clock size={16}/>}
                  </span>
                  <span className="evidence-kind">{e.kind}</span>
                  <span className="evidence-uri">{e.uri}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    )}
  </div>;
}
