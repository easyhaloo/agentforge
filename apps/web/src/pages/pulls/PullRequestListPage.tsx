import { useCallback, useEffect, useState } from "react";
import { GitPullRequest, Plus, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { changesetAPI, type OrganizationSummary, type StoredChangeset } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { pullRequestPath, pullRequestComparePath } from "../../shared/routing";
import { Button, SearchInput, Select } from "../../shared/ui";

type Props = { organization: OrganizationSummary; repository: string; handle: string };

type PullState = "open" | "closed";

function readPullFilters(params: URLSearchParams) {
  const state = params.get("state") ?? "";
  return {
    q: params.get("q") ?? "",
    state: state === "closed" ? "closed" as const : "open" as const,
    reviewer: params.get("reviewer") === "me" ? "me" : "",
    offset: Math.max(0, Number(params.get("offset")) || 0),
  };
}

function pullRequestState(changeset: StoredChangeset): "open" | "closed" | "merged" {
  if (changeset.status === "merged") return "merged";
  if (changeset.changeset.pull_request?.closed) return "closed";
  return "open";
}

export function PullRequestListPage({ organization, repository, handle }: Props) {
  const { t } = useTranslation(["pulls", "common"]);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readPullFilters(searchParams);
  const [queryDraft, setQueryDraft] = useState(filters.q);
  const [items, setItems] = useState<StoredChangeset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void changesetAPI.list(organization.id, { repository, ...filters }).then(page => {
      if (!active) return;
      setItems(page.items);
      setTotal(page.total);
    }).catch(cause => { if (active) setError(translateError(cause, t, "pulls:errors.loadFailed")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, repository, filters.state, filters.q, filters.reviewer, filters.offset, t]);
  useEffect(() => { setQueryDraft(filters.q); }, [filters.q]);

  const applyFilters = (patch: { q?: string; state?: PullState; reviewer?: string; offset?: number }) => {
    const next = new URLSearchParams(searchParams);
    if (patch.offset === undefined) next.delete("offset");
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, String(value)); else next.delete(key);
    }
    setSearchParams(next);
  };

  return <section className="pull-requests-page">
    <div className="pull-requests-header">
      <div className="pull-requests-search">
        <SearchInput
          value={queryDraft}
          onChange={setQueryDraft}
          onSearch={value => applyFilters({ q: value })}
          placeholder={t("pulls:list.searchPlaceholder")}
        />
        <Link className="button primary" to={pullRequestComparePath(handle, repository)}>
          <Plus size={14}/> {t("pulls:list.newPullRequest")}
        </Link>
      </div>
      <div className="pull-requests-filters">
        <Button
          className="button secondary"
          aria-pressed={filters.state === "open"}
          onClick={() => applyFilters({ state: "open" })}
        >
          {t("pulls:list.openPulls")}
        </Button>
        <Button
          className="button secondary"
          aria-pressed={filters.state === "closed"}
          onClick={() => applyFilters({ state: "closed" })}
        >
          {t("pulls:list.closedPulls")}
        </Button>
        <Button aria-pressed={filters.reviewer === "me"} onClick={() => applyFilters({ reviewer: filters.reviewer ? "" : "me" })}>{t("pulls:list.assignedToMe")}</Button>
      </div>
    </div>

    {error && <div className="org-error" role="alert">{error}</div>}

    {loading ? (
      <div className="org-loading">{t("common:status.loading")}</div>
    ) : items.length === 0 ? (
      <div className="org-admin-empty card">
        <GitPullRequest size={22}/>
        <h2>{filters.state === "open" ? t("pulls:list.emptyOpen") : filters.state === "closed" ? t("pulls:list.emptyClosed") : t("pulls:list.emptyFiltered")}</h2>
      </div>
    ) : (
      <div className="pull-requests-list card">
        {items.map(pr => {
          const prData = pr.changeset.pull_request!;
          const state = pullRequestState(pr);
          return <Link key={pr.changeset.id} className="pull-request-row" to={pullRequestPath(handle, repository, pr.changeset.id)}>
            <div className="pull-request-row__icon">
              <GitPullRequest size={16} className={`pull-state-${state}`}/>
            </div>
            <div className="pull-request-row__content">
              <h3>{pr.changeset.title} {prData.draft && <span className="pull-draft-badge">{t("pulls:detail.draft")}</span>}</h3>
              <p className="pull-request-meta">
                #{pr.changeset.id.slice(0, 7)} · {pr.changeset.created_by} · {prData.source_branch} → {prData.base_branch} · {t("pulls:list.comments", { count: prData.comments.length })}
              </p>
            </div>
            <div className="pull-request-row__state">
              <span className={`pull-state pull-state-${state}`}>{t(`pulls:state.${state}`)}</span>
            </div>
          </Link>;
        })}
      </div>
    )}
    {!loading && total > 20 && <div className="org-actions">
      <Button disabled={filters.offset === 0} onClick={() => applyFilters({ offset: Math.max(0, filters.offset - 20) })}>{t("pulls:list.previous")}</Button>
      <Button disabled={filters.offset + 20 >= total} onClick={() => applyFilters({ offset: filters.offset + 20 })}>{t("pulls:list.next")}</Button>
    </div>}
  </section>;
}
