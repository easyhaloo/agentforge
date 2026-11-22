import { GitCommitHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDateFormatting } from "../../shared/i18n/format";
import type { RepositoryCommit } from "../../shared/api/identity";

export function PullRequestCommitsTab({ commits, truncated }: { commits: RepositoryCommit[]; truncated: boolean }) {
  const { t } = useTranslation("pulls");
  const { formatDateTime } = useDateFormatting();

  return <div className="pull-commits-tab card">
    <div className="pull-commits-header">
      <h3>{t("pulls:commits.title")}</h3>
      <p>{truncated ? t("pulls:commits.truncated", { count: commits.length }) : t("pulls:commits.count", { count: commits.length })}</p>
    </div>
    {commits.length === 0 ? (
      <p className="text-muted">{t("pulls:commits.noCommits")}</p>
    ) : (
      <div className="commit-list">
        {commits.map(commit => (
          <div key={commit.sha} className="commit-item">
            <div className="commit-icon"><GitCommitHorizontal size={18} aria-hidden="true"/></div>
            <div className="commit-content">
              <div className="commit-subject">{commit.subject}</div>
              <div className="commit-meta">
                <span>{t("pulls:commits.author", { author: commit.author, date: formatDateTime(commit.authored_at) })}</span>
              </div>
            </div>
            <code className="commit-sha" title={commit.sha}>{commit.sha.slice(0, 7)}</code>
          </div>
        ))}
      </div>
    )}
  </div>;
}
