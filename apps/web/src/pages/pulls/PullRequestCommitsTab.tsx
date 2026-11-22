import { useCallback, useEffect, useState } from "react";
import { GitCommitHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { changesetAPI, type OrganizationSummary, type StoredChangeset, type RepositoryCommit } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";

type Props = {
  organization: OrganizationSummary;
  changeset: StoredChangeset;
};

export function PullRequestCommitsTab({ organization, changeset }: Props) {
  const { t } = useTranslation(["pulls", "common"]);
  const [commits, setCommits] = useState<RepositoryCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const id = changeset.changeset.id;
  const version = changeset.version;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const history = await changesetAPI.getComparison(organization.id, id);
      setCommits(history.commits);
    } catch (cause) { setError(translateError(cause, t, "pulls:errors.compareFailed")); }
    finally { setLoading(false); }
  }, [organization.id, id, version, t]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="org-loading">{t("common:status.loading")}</div>;
  if (error) return <div className="org-error" role="alert">{error}</div>;

  return <div className="pull-commits-tab card">
    <div className="pull-commits-header">
      <h3>{t("pulls:commits.title")}</h3>
      <p>{t("pulls:commits.count", { count: commits.length })}</p>
    </div>
    {commits.length === 0 ? (
      <p className="text-muted">{t("pulls:commits.noCommits")}</p>
    ) : (
      <div className="commit-list">
        {commits.map(commit => (
          <div key={commit.sha} className="commit-item">
            <div className="commit-icon"><GitCommitHorizontal size={16}/></div>
            <div className="commit-content">
              <div className="commit-subject">{commit.subject}</div>
              <div className="commit-meta">
                <span className="commit-sha" title={commit.sha}>{commit.sha.slice(0, 7)}</span>
                <span>{t("pulls:commits.author", { author: commit.author, date: new Date(commit.authored_at).toLocaleString() })}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>;
}
