import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button, Modal, Select } from "../../shared/ui";
import type { OrganizationSummary } from "../../shared/api/identity";
import { issuesAPI, type Issue, type IssueStateReason, type IssueUpdate } from "../../shared/api/issues";
import { translateError } from "../../shared/api/errors";
import { formatDateTime } from "../../shared/i18n/format";
import { organizationHandle, repositoryPath } from "../../shared/routing";
import { RepositoryReadme } from "./RepositoryReadme";
import { IssueForm } from "./IssueForm";
import "./repositories.css";

interface IssueDetailPageProps {
  organization: OrganizationSummary;
  repository: string;
  issueNumber: number;
  onNotify: (message: string) => void;
}

export function IssueDetailPage({ organization, repository, issueNumber, onNotify }: IssueDetailPageProps) {
  const { t } = useTranslation("repositories");
  const handle = organizationHandle(organization);

  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [showEditModal, setShowEditModal] = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [closeReason, setCloseReason] = useState<IssueStateReason>("completed");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await issuesAPI.get(organization.id, issueNumber, repository);
      setIssue(result);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:issues.detail.loadFailed"));
      setIssue(null);
    } finally {
      setLoading(false);
    }
  }, [organization.id, issueNumber, repository, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpdate = async (data: IssueUpdate) => {
    if (!issue) return;
    setBusy(true);
    setError("");
    try {
      const updated = await issuesAPI.update(organization.id, issueNumber, repository, data);
      setIssue(updated);
      setShowEditModal(false);
      onNotify(t("issues.detail.updateSuccess"));
    } catch (cause) {
      throw new Error(translateError(cause, t, "repositories:issues.detail.updateFailed"));
    } finally {
      setBusy(false);
    }
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
        <Link
          className="af-button af-button--secondary af-button--small"
          to={repositoryPath(handle, repository, "issues")}
        >
          {t("issues.detail.backToList")}
        </Link>
      </section>
    );
  }

  return (
    <>
      <section className="issue-detail">
        <header className="issue-detail__header">
          <Link className="issue-detail__back" to={repositoryPath(handle, repository, "issues")}>
            {t("issues.detail.backToList")}
          </Link>
          <div className="issue-detail__title-row">
            <h2 className="issue-detail__title">
              {issue.title}{" "}<span className="issue-number">#{issue.number}</span>
            </h2>
            <Button variant="secondary" size="small" onClick={() => setShowEditModal(true)} disabled={busy}>
              {t("common:actions.edit")}
            </Button>
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
            <span>{t("issues.detail.commentCount", { count: issue.comments })}</span>
            {issue.closed_at && issue.closed_by && (
              <span>
                {t("issues.detail.closedBy", {
                  author: issue.closed_by,
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
            <section className="issue-detail__description" aria-label={t("issues.detail.description")}>
              <header>{t("issues.detail.createdBy", { author: issue.created_by, date: formatDateTime(issue.created_at) })}</header>
              <div className="issue-detail__body">
                {issue.body ? (
                  <RepositoryReadme content={issue.body} sourcePath="issue.md" />
                ) : (
                  <p className="issue-detail__no-description">{t("issues.detail.noDescription")}</p>
                )}
              </div>
            </section>
            <div className="issue-detail__actions">
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
            </div>
          </div>

          {/* Sidebar with metadata */}
          <aside className="issue-detail__sidebar">
            {/* Assignees */}
            <div className="issue-sidebar-section">
              <h3>{t("issues.assignees")}</h3>
              {issue.assignees.length > 0 ? (
                <ul className="issue-assignee-list">
                  {issue.assignees.map((assignee) => (
                    <li key={assignee.user_id}>{assignee.user_id}</li>
                  ))}
                </ul>
              ) : (
                <p className="issue-sidebar-empty">{t("issues.noAssignees")}</p>
              )}
            </div>

            {/* Labels */}
            <div className="issue-sidebar-section">
              <h3>{t("issues.labels")}</h3>
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

            {/* Milestone */}
            <div className="issue-sidebar-section">
              <h3>{t("issues.milestone")}</h3>
              {issue.milestone_id ? (
                <p>{issue.milestone_id}</p>
              ) : (
                <p className="issue-sidebar-empty">{t("issues.noMilestone")}</p>
              )}
            </div>

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

      {/* Edit Modal */}
      {showEditModal && (
        <Modal
          open={showEditModal}
          onCancel={() => setShowEditModal(false)}
          title={t("issues.detail.editIssue")}
          confirmLoading={busy}
        >
          <IssueForm
            mode="edit"
            issue={issue}
            onSubmit={handleUpdate}
            onCancel={() => setShowEditModal(false)}
            busy={busy}
          />
        </Modal>
      )}

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
              <label htmlFor="close-reason">{t("issues.detail.closeReason")}</label>
              <Select
                id="close-reason"
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
