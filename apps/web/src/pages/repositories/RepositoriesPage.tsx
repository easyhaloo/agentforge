import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDownWideNarrow, Book, Bookmark, CaseSensitive, CircleX, GitBranch, GitFork, GitPullRequest,
  History, Lightbulb, Menu, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Rows2, Search,
  Settings, Star, UserRound, UsersRound, Workflow, X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { repositoryAPI, type OrganizationSummary, type RepositorySummary } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { formatDateTime, formatRelativeTime } from "../../shared/i18n/format";
import { organizationHandle, repositoryChangesetsPath, repositoryPath } from "../../shared/routing";
import { Button, Input, Modal, Select } from "../../shared/ui";
import { canManageRepository } from "./RepositorySectionPage";
import "./repositories.css";

const languageColors: Record<string, string> = {
  Go: "#00add8", TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572a5", Rust: "#dea584",
  Java: "#b07219", Kotlin: "#a97bff", Shell: "#89e051", Ruby: "#701516", CSS: "#663399", HTML: "#e34c26",
  Swift: "#f05138", Vue: "#41b883", C: "#555555", "C++": "#f34b7d", "C#": "#178600",
};
const latestActivity = (item: RepositorySummary) => item.git?.last_commit_at || item.updated_at;
const ownRepositories = "created-by:@me";
const managedRepositories = "access:admin";

type Props = {
  organization: OrganizationSummary;
  onNotify: (message: string) => void;
  userID: string;
};

type SavedView = { name: string; filters: string };

function readViews(key: string): SavedView[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(saved) ? saved.filter(view => typeof view?.name === "string" && typeof view?.filters === "string") : [];
  } catch {
    return [];
  }
}

export function RepositoriesPage({ organization, onNotify, userID }: Props) {
  const { t } = useTranslation("repositories");
  const [items, setItems] = useState<RepositorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useSearchParams();
  const registrationOpen = search.get("register") === "1";
  const sortParam = search.get("sort");
  const sort = sortParam === "name" || sortParam === "last-commit" ? sortParam : "relevance";
  const legacyScope = search.get("view") === "mine" ? `${ownRepositories} ` : "";
  const query = legacyScope + (search.get("q") ?? "");
  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const mine = terms.includes(ownRepositories);
  const adminAccess = terms.includes(managedRepositories);
  const searchInput = useRef<HTMLInputElement>(null);
  const compact = search.get("layout") === "compact";
  const filters = new URLSearchParams();
  if (query.trim()) filters.set("q", query.trim());
  if (sort !== "relevance") filters.set("sort", sort);
  if (compact) filters.set("layout", "compact");
  const storageKey = `agentforge:repository-views:${userID}:${organization.id}`;
  const [views, setViews] = useState(() => readViews(storageKey));
  const [viewName, setViewName] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const updateViews = (next: SavedView[]) => {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the views available in this page. */ }
    setViews(next);
  };
  const setOption = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: key === "register" && !value });
  };
  const setQuery = (value: string, replace = true) => {
    const next = new URLSearchParams(search);
    next.delete("view");
    if (value) next.set("q", value);
    else next.delete("q");
    if (next.toString() !== search.toString()) setSearch(next, { replace });
  };
  const setScope = (scope: string) => {
    const rest = query.trim().split(/\s+/).filter(term => ![ownRepositories, managedRepositories].includes(term.toLowerCase()));
    setQuery([scope, ...rest].filter(Boolean).join(" "), false);
  };
  const [registrationError, setRegistrationError] = useState("");
  const [slug, setSlug] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const canRegister = canManageRepository(organization);
  const handle = organizationHandle(organization);
  const filtered = useMemo(() => {
    const matching = items.flatMap(item => {
      const slug = item.slug.toLowerCase();
      const name = slug.slice(slug.indexOf("/") + 1);
      let relevance = 0;
      for (const term of terms) {
        if (term === ownRepositories) {
          if (item.created_by !== userID) return [];
        } else if (term === managedRepositories) {
          if (!canRegister) return [];
        } else if (term.startsWith("branch:")) {
          if (item.default_branch.toLowerCase() !== term.slice(7)) return [];
        } else if (term.startsWith("language:")) {
          if (item.git?.language?.toLowerCase() !== term.slice(9)) return [];
        } else if (term.startsWith("repo:")) {
          if (slug !== term.slice(5) && name !== term.slice(5)) return [];
        } else {
          if (!slug.includes(term)) return [];
          // ponytail: rank exact and prefix matches in the loaded catalog; move search to the API if the catalog is paginated.
          relevance += slug === term || name === term ? 3 : slug.startsWith(term) || name.startsWith(term) ? 2 : 1;
        }
      }
      return [{ item, relevance }];
    });
    const time = (value?: string) => Date.parse(value ?? "") || 0;
    return matching.sort((a, b) => {
      const byName = a.item.slug.localeCompare(b.item.slug);
      if (sort === "name") return byName;
      if (sort === "last-commit") return time(b.item.git?.last_commit_at) - time(a.item.git?.last_commit_at) || byName;
      return b.relevance - a.relevance || time(latestActivity(b.item)) - time(latestActivity(a.item)) || byName;
    }).map(({ item }) => item);
  }, [canRegister, items, sort, terms, userID]);
  useEffect(() => {
    if (!registrationOpen) return;
    setSlug("");
    setDefaultBranch("main");
    setRegistrationError("");
  }, [registrationOpen]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems((await repositoryAPI.summaries(organization.id)).items);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:feedback.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [organization.id, t]);
  useEffect(() => { void load(); }, [load]);

  const register = async () => {
    setRegistrationError("");
    try {
      const added = await repositoryAPI.register(organization.id, slug.trim(), defaultBranch.trim());
      setItems(current => [...current.filter(item => item.slug !== added.slug), added]);
      const next = new URLSearchParams(search);
      next.delete("q");
      next.delete("view");
      next.delete("register");
      setSearch(next, { replace: true });
      onNotify(t("repositories:feedback.registered"));
      void load();
    } catch (cause) {
      setRegistrationError(translateError(cause, t, "repositories:feedback.registrationFailed"));
    }
  };

  const sidebarLabel = t(collapsed ? "repositories:catalog.expandSidebar" : "repositories:catalog.collapseSidebar");
  const sidebarToggle = <Button variant="ghost" className="repo-catalog-toggle" aria-expanded={!collapsed}
    aria-controls="repository-views" aria-label={sidebarLabel} title={sidebarLabel} onClick={() => setCollapsed(!collapsed)}>
    {collapsed ? <PanelLeftOpen size={16} aria-hidden="true"/> : <PanelLeftClose size={16} aria-hidden="true"/>}
    {!collapsed && sidebarLabel}
  </Button>;

  return <div className={`collection-shell repo-catalog-shell${collapsed ? " is-collapsed" : ""}`}>
    <aside className="collection-sidebar repo-catalog-sidebar">
      <div id="repository-views" hidden={collapsed}>
        <nav aria-label={t("repositories:catalog.views")}>
          <Button variant="ghost" className="af-action-row" aria-current={!mine && !adminAccess ? "page" : undefined} onClick={() => setScope("")}>
            <Book size={16} aria-hidden="true"/>{t("repositories:catalog.all")}
          </Button>
          <Button variant="ghost" className="af-action-row" aria-disabled="true" title={t("repositories:catalog.contributionsUnavailable")}>
            <UsersRound size={16} aria-hidden="true"/>{t("repositories:catalog.contributions")}
          </Button>
          <Button variant="ghost" className="af-action-row" aria-current={mine ? "page" : undefined} onClick={() => setScope(ownRepositories)}>
            <UserRound size={16} aria-hidden="true"/>{t("repositories:catalog.mine")}
          </Button>
          <Button variant="ghost" className="af-action-row" aria-disabled="true" title={t("repositories:catalog.forksUnavailable")}>
            <GitFork size={16} aria-hidden="true"/>{t("repositories:catalog.forks")}
          </Button>
          <Button variant="ghost" className="af-action-row" aria-current={adminAccess && !mine ? "page" : undefined} onClick={() => setScope(managedRepositories)}>
            <Settings size={16} aria-hidden="true"/>{t("repositories:catalog.adminAccess")}
          </Button>
        </nav>
        <section className="repo-catalog-views" aria-labelledby="saved-repository-views">
          <div>
            <strong id="saved-repository-views"><Bookmark size={16} aria-hidden="true"/>{t("repositories:catalog.savedViews")}</strong>
            <Button variant="ghost" size="small" aria-label={t("repositories:catalog.saveView")} title={t("repositories:catalog.saveView")}
              onClick={() => { setViewName(""); setSaveOpen(true); }}><Plus size={16} aria-hidden="true"/></Button>
          </div>
          {views.length ? <ul>{views.map(view => <li className="af-action-row" key={view.name}>
            <Button variant="ghost" aria-pressed={view.filters === filters.toString()} onClick={() => setSearch(view.filters)}>{view.name}</Button>
            <Button variant="ghost" size="small" aria-label={t("repositories:catalog.removeView", { name: view.name })}
              title={t("repositories:catalog.removeView", { name: view.name })}
              onClick={() => updateViews(views.filter(item => item.name !== view.name))}><X size={14} aria-hidden="true"/></Button>
          </li>)}</ul> : <p>{t("repositories:catalog.noViews")}</p>}
        </section>
      </div>
      {sidebarToggle}
    </aside>
    <section className="collection-content repo-catalog" aria-labelledby="repo-catalog-heading">
      <header className="collection-heading page-heading">
        <h1 id="repo-catalog-heading">{t(mine ? "repositories:catalog.mine" : adminAccess ? "repositories:catalog.adminAccess" : "navigation:routes.repositories")}</h1>
        {canRegister && <Button variant="primary" onClick={() => setOption("register", "1")}>{t("repositories:catalog.register")}</Button>}
      </header>
      <form className="repo-catalog-filter" role="search" aria-label={t("repositories:catalog.search")}
        onSubmit={event => { event.preventDefault(); setQuery(query.trim()); }}>
        <div className="repo-catalog-filter__field">
          <Input ref={searchInput} type="text" aria-label={t("repositories:catalog.filter")} placeholder={t("repositories:catalog.filter")}
            value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false}/>
          {query && <Button variant="ghost" aria-label={t("common:actions.clear")} title={t("common:actions.clear")}
            onClick={() => { setQuery(""); searchInput.current?.focus(); }}><CircleX size={16} aria-hidden="true"/></Button>}
        </div>
        <Button type="submit" aria-label={t("repositories:catalog.search")} title={t("repositories:catalog.search")}>
          <Search size={16} aria-hidden="true"/>
        </Button>
      </form>
      {error && <p className="org-error" role="alert">{error}</p>}
      <div className={`repo-catalog-list${compact ? " is-compact" : ""}`}>
        <div className="repo-catalog-list__head">
          <strong aria-live="polite">{loading || error ? t("repositories:page.title") : t("repositories:catalog.count", { count: filtered.length })}</strong>
          <div className="repo-catalog-controls">
            <div className="repo-catalog-sort">
              <ArrowDownWideNarrow size={16} aria-hidden="true"/>
              <Select controlSize="small" aria-label={t("repositories:catalog.sort")} menuTitle={t("repositories:catalog.sortBy")} value={sort}
                onChange={event => setOption("sort", event.target.value === "relevance" ? "" : event.target.value)}
                options={[
                  { value: "relevance", label: t("repositories:catalog.relevance"), icon: UserRound },
                  { value: "last-commit", label: t("repositories:catalog.lastCommit"), icon: History },
                  { value: "name", label: t("repositories:catalog.name"), icon: CaseSensitive },
                  { value: "stars", label: t("repositories:catalog.stars"), icon: Star, disabled: true, title: t("repositories:catalog.starsUnavailable") },
                ]}/>
            </div>
            <div className="repo-catalog-density" role="group" aria-label={t("repositories:catalog.layout")}>
              <Button size="small" variant="ghost" aria-label={t("repositories:catalog.detailed")} title={t("repositories:catalog.detailed")}
                aria-pressed={!compact} onClick={() => setOption("layout", "")}><Rows2 size={16} aria-hidden="true"/></Button>
              <Button size="small" variant="ghost" aria-label={t("repositories:catalog.compact")} title={t("repositories:catalog.compact")}
                aria-pressed={compact} onClick={() => setOption("layout", "compact")}><Menu size={16} aria-hidden="true"/></Button>
            </div>
          </div>
        </div>
        {loading ? <p className="repo-catalog-empty" role="status">{t("common:components.loading")}</p> : error ? (
          <div className="repo-catalog-empty"><Button onClick={() => void load()}><RefreshCw size={16} aria-hidden="true"/>{t("common:actions.refresh")}</Button></div>
        ) : filtered.length ? (
          <ul aria-label={t("repositories:page.title")}>
            {filtered.map(item => {
              const separator = item.slug.indexOf("/");
              const language = item.git?.language;
              const branchCount = item.git?.branch_count;
              const pullRequests = item.activity?.changeset_count;
              const actions = item.activity?.action_count;
              const updatedAt = latestActivity(item);
              const settingsLabel = t("sections.settingsFor", { repository: item.slug });
              return <li key={item.slug}>
                <span className="repo-catalog-glyph" aria-hidden="true"><Book size={17}/></span>
                <div className="repo-catalog-entry">
                  <Link className="repo-link repo-catalog-name" to={repositoryPath(handle, item.slug)} aria-label={item.slug}>
                    {separator >= 0 ? <><span>{item.slug.slice(0, separator + 1)}</span>{item.slug.slice(separator + 1)}</> : item.slug}
                  </Link>
                  <div className="repo-catalog-meta">
                    {language && <span className="repo-language"><i style={{ backgroundColor: languageColors[language] }} aria-hidden="true"/>{language}</span>}
                    <Link to={repositoryPath(handle, item.slug, "branches")} title={t("sections.branchLabel", { branch: item.default_branch, count: branchCount })}
                      aria-label={t("sections.branchLabel", { branch: item.default_branch, count: branchCount })}>
                      <GitBranch size={16} aria-hidden="true"/><code>{item.default_branch}</code>{branchCount !== undefined && <span>{branchCount}</span>}
                    </Link>
                    <Link to={repositoryChangesetsPath(handle, item.slug)} title={t("sections.pullRequestLabel", { count: pullRequests })}
                      aria-label={t("sections.pullRequestLabel", { count: pullRequests })}>
                      <GitPullRequest size={16} aria-hidden="true"/>{pullRequests ?? "—"}
                    </Link>
                    <Link to={repositoryPath(handle, item.slug, "actions")} title={t("sections.actionLabel", { count: actions })}
                      aria-label={t("sections.actionLabel", { count: actions })}>
                      <Workflow size={16} aria-hidden="true"/>{actions ?? "—"}
                    </Link>
                    <time dateTime={updatedAt} title={formatDateTime(updatedAt)}>{t(item.git?.last_commit_at ? "catalog.updated" : "catalog.catalogUpdated", { time: formatRelativeTime(updatedAt) })}</time>
                    {canRegister && <Link to={repositoryPath(handle, item.slug, "settings")} title={settingsLabel} aria-label={settingsLabel}>
                      <Settings size={16} aria-hidden="true"/>
                    </Link>}
                  </div>
                </div>
              </li>;
            })}
          </ul>
        ) : <p className="repo-catalog-empty">{t(query.trim() || mine ? "repositories:catalog.noMatch" : "repositories:empty")}</p>}
      </div>
      <p className="repo-catalog-tip"><Lightbulb size={16} aria-hidden="true"/>{t("repositories:catalog.filterTip")}</p>
      <Modal open={saveOpen} title={t("repositories:catalog.saveView")} onCancel={() => setSaveOpen(false)}
        okText={t("common:actions.save")} okDisabled={!viewName.trim() || views.some(view => view.name === viewName.trim())}
        onOk={() => { updateViews([...views, { name: viewName.trim(), filters: filters.toString() }]); setSaveOpen(false); }}>
        <Input label={t("repositories:catalog.viewName")} value={viewName} maxLength={60} onChange={event => setViewName(event.target.value)}/>
      </Modal>
      {canRegister && <Modal open={registrationOpen} title={t("repositories:catalog.register")} onCancel={() => setOption("register", "")}
        onOk={register} okText={t("repositories:form.registerButton")} okDisabled={!/^[^/\s]+\/[^/\s]+$/.test(slug.trim()) || !defaultBranch.trim()}>
        <div className="repo-register-fields">
          <p className="repo-meta">{t("repositories:catalog.registerHelp")}</p>
          <Input label={t("repositories:form.slugLabel")} required value={slug} onChange={event => setSlug(event.target.value)} placeholder={t("repositories:form.slugPlaceholder")}/>
          <Input label={t("repositories:form.branchLabel")} required value={defaultBranch} onChange={event => setDefaultBranch(event.target.value)} placeholder={t("repositories:form.branchPlaceholder")}/>
          {registrationError && <p className="org-error" role="alert">{registrationError}</p>}
        </div>
      </Modal>}
    </section>
  </div>;
}
