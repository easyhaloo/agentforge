import { useCallback, useEffect, useState, type FormEvent } from "react";
import { GitBranch, GitCommitHorizontal, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { changesetAPI, repositoryPreviewAPI, type OrganizationSummary, type PullRequestComparison, type RepositoryPreviewRef } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { pullRequestPath } from "../../shared/routing";
import { Button, Input, Select, TextArea, Checkbox } from "../../shared/ui";
import { RepositoryDiffViewer } from "../repositories/RepositoryDiffViewer";

type Props = { organization: OrganizationSummary; repository: string; handle: string };

export function PullRequestComparePage({ organization, repository, handle }: Props) {
  const { t } = useTranslation(["pulls", "common"]);
  const navigate = useNavigate();
  const [refs, setRefs] = useState<RepositoryPreviewRef[]>([]);
  const [baseBranch, setBaseBranch] = useState("");
  const [compareBranch, setCompareBranch] = useState("");
  const [comparison, setComparison] = useState<(PullRequestComparison & { base: string; head: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let live = true;
    void repositoryPreviewAPI.refs(organization.id, repository).then(result => {
      if (!live) return;
      const branches = result.items.filter(ref => ref.kind === "branch");
      setRefs(branches);
      setBaseBranch(result.default_branch);
      setCompareBranch(branches.find(branch => branch.name !== result.default_branch)?.name ?? "");
    }).catch(cause => { if (live) setError(translateError(cause, t, "pulls:errors.compareFailed")); });
    return () => { live = false; };
  }, [organization.id, repository, t]);

  const canCompare = !!baseBranch && !!compareBranch && baseBranch !== compareBranch;
  useEffect(() => {
    let live = true;
    setComparison(null);
    if (!canCompare) { setLoading(false); return; }
    setLoading(true);
    setError("");
    void repositoryPreviewAPI.compareBranches(organization.id, repository, baseBranch, compareBranch)
      .then(result => { if (live) setComparison({ ...result, base: baseBranch, head: compareBranch }); })
      .catch(cause => { if (live) setError(translateError(cause, t, "pulls:errors.compareFailed")); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [organization.id, repository, baseBranch, compareBranch, canCompare, t]);

  const currentComparison = comparison?.base === baseBranch && comparison.head === compareBranch ? comparison : null;
  const hasChanges = !!currentComparison?.patch;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentComparison?.patch || creating || !title.trim()) return;
    setCreating(true); setError("");
    try {
      const result = await changesetAPI.createPullRequest(
        organization.id,
        repository,
        title.trim(),
        baseBranch,
        compareBranch,
        currentComparison.head_sha,
        description.trim(),
        draft
      );
      navigate(pullRequestPath(handle, repository, result.changeset.id));
    } catch (cause) { setError(translateError(cause, t, "pulls:create.failed")); }
    finally { setCreating(false); }
  };


  return <section className="pull-request-compare-page">
    <div className="compare-header card">
      <h2>{t("pulls:compare.title")}</h2>
      <p>{t("pulls:compare.description")}</p>
    </div>

    <div className="compare-branches card">
      <div className="compare-branch-selector">
        <div>
          <Select
            label={t("pulls:compare.baseBranch")}
            disabled={creating}
            value={baseBranch}
            onChange={e => setBaseBranch(e.target.value)}
            options={refs.map(ref => ({ value: ref.name, label: ref.name }))}
          />
        </div>
        <div className="compare-arrow">←</div>
        <div>
          <Select
            label={t("pulls:compare.compareBranch")}
            disabled={creating}
            value={compareBranch}
            onChange={e => setCompareBranch(e.target.value)}
            options={refs.map(ref => ({ value: ref.name, label: ref.name }))}
          />
        </div>
      </div>

      {!canCompare && <div className="compare-hint">
        <AlertTriangle size={16}/>
        {t("pulls:compare.cannotCompare")}
      </div>}

      {loading && <div className="org-loading">{t("pulls:compare.loading")}</div>}

      {currentComparison && hasChanges && (
        <div className="compare-summary">
          <div className="compare-stats">
            <span><GitCommitHorizontal size={16}/> {t("pulls:compare.commits", { count: currentComparison.commits.length })}</span>
          </div>
        </div>
      )}

      {currentComparison && !hasChanges && (
        <div className="compare-hint">{t("pulls:compare.noChanges")}</div>
      )}
    </div>

    {error && <div className="org-error" role="alert">{error}</div>}

    {currentComparison && hasChanges && (
      <>
        <div className="compare-commits card">
          <h3>{t("pulls:commits.title")}</h3>
          <div className="commit-list">
            {currentComparison.commits.slice(0, 10).map(commit => (
              <div key={commit.sha} className="commit-item">
                <span className="commit-sha" title={commit.sha}>{commit.sha.slice(0, 7)}</span>
                <span className="commit-subject">{commit.subject}</span>
                <span className="commit-author">{commit.author}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="compare-diff card">
          <h3>{t("pulls:files.title")}</h3>
          <RepositoryDiffViewer patch={currentComparison.patch}/>
        </div>

        <form className="pull-request-create-form card" onSubmit={create}>
          <h3>{t("pulls:create.title")}</h3>
          <p>{t("pulls:create.description", { source: compareBranch, base: baseBranch })}</p>
          <Input
            label={t("pulls:create.titleLabel")}
            required
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t("pulls:create.titlePlaceholder")}
            maxLength={200}
          />
          <TextArea
            label={t("pulls:create.descriptionLabel")}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t("pulls:create.descriptionPlaceholder")}
            rows={6}
          />
          <Checkbox
            label={t("pulls:create.draftLabel")}
            checked={draft}
            onChange={e => setDraft(e.target.checked)}
          />
          <p className="field-help">{t("pulls:create.draftHelp")}</p>
          <div className="form-actions">
            <Button type="submit" className="button primary" disabled={creating || !title.trim()}>
              {creating ? t("pulls:create.creating") : (draft ? t("pulls:create.createDraftButton") : t("pulls:create.createButton"))}
            </Button>
          </div>
        </form>
      </>
    )}
  </section>;
}
