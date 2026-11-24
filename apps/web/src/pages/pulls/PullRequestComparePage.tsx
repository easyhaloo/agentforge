import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, FileDiff, GitCommitHorizontal } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { changesetAPI, repositoryPreviewAPI, type OrganizationSummary, type PullRequestComparison, type RepositoryPreviewRef } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { issueDetailPath, pullRequestPath } from "../../shared/routing";
import { Button, Input, Popover, Select, TextArea } from "../../shared/ui";
import { RepositoryDiffViewer } from "../repositories/RepositoryDiffViewer";
import "./list-compare.css";

type Props = { organization: OrganizationSummary; repository: string; handle: string };

export function PullRequestComparePage({ organization, repository, handle }: Props) {
  const { t } = useTranslation(["pulls", "common"]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const issue = searchParams.get("issue");
  const issueNumber = issue !== null && /^[1-9]\d*$/.test(issue) && Number(issue) <= 2147483647 ? Number(issue) : undefined;
  const invalidIssue = issue !== null && issueNumber === undefined;
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
    if (!currentComparison?.patch || creating || !title.trim() || invalidIssue) return;
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
        draft,
        issueNumber
      );
      navigate(pullRequestPath(handle, repository, result.changeset.id));
    } catch (cause) { setError(translateError(cause, t, "pulls:create.failed")); }
    finally { setCreating(false); }
  };

  const branchOptions = refs.map(ref => ({ value: ref.name, label: ref.name }));
  const readyLabel = t("pulls:create.createButton");
  const draftLabel = t("pulls:create.createDraftButton");
  const modeMenuLabel = t("common:components.additionalOptions");

  return <section className="af-pr-compare" aria-labelledby="af-pr-compare-title">
    <header className="af-pr-compare__heading">
      <h2 id="af-pr-compare-title">{t("pulls:compare.title")}</h2>
      <p>{t("pulls:compare.description")}</p>
      {issueNumber !== undefined && <p><Link to={issueDetailPath(handle, repository, issueNumber)}>{t("pulls:create.linkIssue", { number: issueNumber })}</Link></p>}
      {invalidIssue && <p role="alert">{t("pulls:create.invalidIssue")}</p>}
    </header>

    <div className="af-pr-compare__branch-panel">
      <div className="af-pr-compare__branches">
        <Select
          label={t("pulls:compare.baseBranch")}
          hint={t("pulls:compare.baseBranchHelp")}
          disabled={creating}
          value={baseBranch}
          onChange={e => setBaseBranch(e.target.value)}
          options={branchOptions}
        />
        <ArrowLeft className="af-pr-compare__direction" size={16} aria-hidden="true"/>
        <Select
          label={t("pulls:compare.compareBranch")}
          hint={t("pulls:compare.compareBranchHelp")}
          disabled={creating}
          value={compareBranch}
          onChange={e => setCompareBranch(e.target.value)}
          options={branchOptions}
        />
      </div>

      {!canCompare && <div className="af-pr-compare__status af-pr-compare__status--warning" role="status">
        <AlertTriangle size={16} aria-hidden="true"/>
        {t("pulls:compare.cannotCompare")}
      </div>}

      {loading && <div className="af-pr-compare__status" role="status">{t("pulls:compare.loading")}</div>}

      {currentComparison && !hasChanges && (
        <div className="af-pr-compare__status" role="status">{t("pulls:compare.noChanges")}</div>
      )}
    </div>

    {error && <div className="org-error" role="alert">{error}</div>}

    {currentComparison && hasChanges && (
      <>
        <form className="af-pr-compare__form" onSubmit={create} aria-labelledby="af-pr-compare-create-title">
          <header className="af-pr-compare__heading">
            <h3 id="af-pr-compare-create-title">{t("pulls:create.title")}</h3>
            <p>{t("pulls:create.description", { source: compareBranch, base: baseBranch })}</p>
          </header>
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
          <fieldset className="af-pr-compare__form-actions" disabled={creating}>
            <Button type="submit" variant="primary" disabled={!title.trim() || invalidIssue}>
              {creating ? t("pulls:create.creating") : draft ? draftLabel : readyLabel}
            </Button>
            <Popover
              ariaLabel={modeMenuLabel}
              triggerClassName="af-button af-button--primary"
              trigger={<>
                <ChevronDown size={16} aria-hidden="true" />
                <span className="af-pr-compare__sr-only">{modeMenuLabel}</span>
              </>}
            >
              {dismiss => <div role="menu" aria-label={modeMenuLabel} onKeyDown={event => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                const [readyOption, draftOption] = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]");
                (event.target === readyOption ? draftOption : readyOption).focus();
              }}>
                <Button className="af-action-row" role="menuitemradio" aria-checked={!draft} onClick={() => { setDraft(false); dismiss(); }}>
                  <Check size={16} aria-hidden="true" />
                  {readyLabel}
                </Button>
                <Button className="af-action-row" role="menuitemradio" aria-checked={draft}
                  aria-labelledby="af-pr-compare-draft-label" aria-describedby="af-pr-compare-draft-help"
                  onClick={() => { setDraft(true); dismiss(); }}>
                  <Check size={16} aria-hidden="true" />
                  <span>
                    <span id="af-pr-compare-draft-label">{draftLabel}</span>
                    <small id="af-pr-compare-draft-help">{t("pulls:create.draftHelp")}</small>
                  </span>
                </Button>
              </div>}
            </Popover>
          </fieldset>
        </form>

        <section className="af-pr-compare__preview" aria-labelledby="af-pr-compare-preview-title">
          <h3 id="af-pr-compare-preview-title">{t("pulls:compare.previewChanges")}</h3>
          <div className="af-pr-compare__commits">
            <h4><GitCommitHorizontal size={16} aria-hidden="true"/> {t("pulls:compare.commits", { count: currentComparison.commits.length })}</h4>
            <ul>
              {currentComparison.commits.slice(0, 10).map(commit => (
                <li key={commit.sha}>
                  <code title={commit.sha}>{commit.sha.slice(0, 7)}</code>
                  <strong>{commit.subject}</strong>
                  <span>{commit.author}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="af-pr-compare__diff">
            <h4><FileDiff size={16} aria-hidden="true"/> {t("pulls:files.title")}</h4>
            <RepositoryDiffViewer patch={currentComparison.patch}/>
          </div>
        </section>
      </>
    )}
  </section>;
}
