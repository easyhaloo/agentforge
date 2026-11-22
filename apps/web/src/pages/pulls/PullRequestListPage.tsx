import { useEffect, useState } from "react";
import { GitMerge, GitPullRequest, GitPullRequestClosed, Plus, UserCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { changesetAPI, type OrganizationSummary, type StoredChangeset } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { pullRequestPath, pullRequestComparePath } from "../../shared/routing";
import { Button, SearchInput } from "../../shared/ui";
import "./list-compare.css";

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

  return <section className="af-pr-list" aria-label={t("pulls:list.title")}>
    <div className="af-pr-list__toolbar">
      <SearchInput
        value={queryDraft}
        onChange={setQueryDraft}
        onSearch={value => applyFilters({ q: value })}
        placeholder={t("pulls:list.searchPlaceholder")}
      />
      <Link className="button primary" to={pullRequestComparePath(handle, repository)}>
        <Plus size={16} aria-hidden="true"/> {t("pulls:list.newPullRequest")}
      </Link>
    </div>

    <div className="af-pr-list__panel">
      <div className="af-pr-list__filters">
        <div className="af-pr-list__states" role="group" aria-label={t("pulls:list.filterByState")}>
          <Button aria-pressed={filters.state === "open"} onClick={() => applyFilters({ state: "open" })}>
            <GitPullRequest size={16} aria-hidden="true"/> {t("pulls:list.openPulls")}
          </Button>
          <Button aria-pressed={filters.state === "closed"} onClick={() => applyFilters({ state: "closed" })}>
            <GitPullRequestClosed size={16} aria-hidden="true"/> {t("pulls:list.closedPulls")}
          </Button>
        </div>
        <Button
          className="af-pr-list__reviewer"
          aria-pressed={filters.reviewer === "me"}
          onClick={() => applyFilters({ reviewer: filters.reviewer ? "" : "me" })}
        >
          <UserCheck size={16} aria-hidden="true"/> {t("pulls:list.assignedToMe")}
        </Button>
      </div>

      {error && <div className="org-error" role="alert">{error}</div>}
      {loading ? (
        <div className="org-loading" role="status">{t("common:status.loading")}</div>
      ) : items.length === 0 ? (
        <div className="af-pr-list__empty">
          <GitPullRequest size={24} aria-hidden="true"/>
          <h2>{filters.state === "open" ? t("pulls:list.emptyOpen") : t("pulls:list.emptyClosed")}</h2>
        </div>
      ) : (
        <ul className="af-pr-list__items">
          {items.map(pr => {
            const prData = pr.changeset.pull_request!;
            const state = pullRequestState(pr);
            const StateIcon = state === "merged" ? GitMerge : state === "closed" ? GitPullRequestClosed : GitPullRequest;
            return <li key={pr.changeset.id}>
              <Link className="af-pr-list__row" to={pullRequestPath(handle, repository, pr.changeset.id)}>
                <StateIcon size={17} aria-hidden="true" className={`af-pr-list__icon af-pr-list__tone--${state}`}/>
                <div className="af-pr-list__content">
                  <h3>{pr.changeset.title} {prData.draft && <span className="af-pr-list__draft">{t("pulls:detail.draft")}</span>}</h3>
                  <p className="af-pr-list__meta">
                    #{pr.changeset.id.slice(0, 7)} · {pr.changeset.created_by} · {prData.source_branch} → {prData.base_branch} · {t("pulls:list.comments", { count: prData.comments.length })}
                  </p>
                </div>
                <span className={`af-pr-list__state af-pr-list__tone--${state}`}>{t(`pulls:state.${state}`)}</span>
              </Link>
            </li>;
          })}
        </ul>
      )}
    </div>
    {!loading && total > 20 && <div className="af-pr-list__pagination">
      <Button disabled={filters.offset === 0} onClick={() => applyFilters({ offset: Math.max(0, filters.offset - 20) })}>{t("pulls:list.previous")}</Button>
      <Button disabled={filters.offset + 20 >= total} onClick={() => applyFilters({ offset: filters.offset + 20 })}>{t("pulls:list.next")}</Button>
    </div>}
  </section>;
}
