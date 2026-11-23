import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Book, CircleDot, Clock, GitCommitHorizontal, Search, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { issuesAPI, type IssuePage } from "../../shared/api/issues";
import { repositoryAPI, type RepositoryMetadata } from "../../shared/api/identity";
import { readPersistentValue } from "../../shared/hooks/usePersistentState";
import { Button, Input } from "../../shared/ui";
import { CURRENT_ORGANIZATION_HANDLE, issueDetailPath, organizationHandle, orgPath, repositoryPath } from "../../shared/routing";
import { CHANGESET_QUERY_MAX } from "../../pages/changesets/changeset-filters";
import { itemHref, navigationItems } from "../navigation";
import { labelToNavKey } from "../navigation-labels";
import { useAppAccount } from "../account-context";
import { useNavigateTo } from "../useNavigateTo";

type PanelProps = { onClose: () => void; repository?: string; linkHandle?: string };
type Result<T> = { key: string; data: T } | { key: string; failed: true };
type Option = { id: string; label: string; icon: LucideIcon; detail?: string; href?: string; query?: string; repository?: string; action?: string };
const previewLimit = 5;

export function CommandPalette({ open, ...props }: PanelProps & { open: boolean }) {
  return open ? <SearchPanel {...props} /> : null;
}

function SearchPanel({ onClose, repository, linkHandle }: PanelProps) {
  const { t } = useTranslation("navigation");
  const { account, selectedOrganization } = useAppAccount();
  const navigateTo = useNavigateTo();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [query, setQuery] = useState(repository ? `repo:${repository} ` : "");
  const [composing, setComposing] = useState(false);
  const [activeId, setActiveId] = useState("");
  const orgId = selectedOrganization?.id ?? "";
  const handle = linkHandle || (selectedOrganization ? organizationHandle(selectedOrganization) : CURRENT_ORGANIZATION_HANDLE);
  const qualifiers = composing ? [] : [...query.matchAll(/(^|\s)repo:(\S*)/gi)];
  const qualifier = qualifiers[0];
  const scopeText = qualifier?.[2];
  const scopeEnd = qualifier ? (qualifier.index ?? 0) + qualifier[0].length : 0;
  const scopeStart = scopeEnd - (scopeText?.length ?? 0);
  const keyword = composing ? "" : qualifier
    ? [query.slice(0, qualifier.index).trim(), query.slice(scopeEnd).trim()].filter(Boolean).join(" ")
    : query.trim();
  const needle = keyword.toLowerCase();
  const historyKey = `agentforge-search:${JSON.stringify([account?.user_id, orgId])}`;
  const history = orgId ? readPersistentValue<unknown>(historyKey, []) : [];
  const recent = orgId && Array.isArray(history) ? history.filter((item): item is string => typeof item === "string") : [];
  const [repoRetry, setRepoRetry] = useState(0);
  const [issueRetry, setIssueRetry] = useState(0);
  const [repositories, setRepositories] = useState<Result<RepositoryMetadata[]>>();
  const [issues, setIssues] = useState<Result<IssuePage>>();
  const repoKey = JSON.stringify([orgId, repoRetry]);
  const repoResult = repositories?.key === repoKey ? repositories : undefined;
  const repoList = repoResult && "data" in repoResult ? repoResult.data : [];
  const scopeNeedle = scopeText?.toLowerCase();
  const repoScope = scopeNeedle && qualifiers.length === 1 ? repoList.find(item => item.slug.toLowerCase() === scopeNeedle)?.slug : undefined;
  const keywordTooLong = keyword.length > CHANGESET_QUERY_MAX;
  const canSearch = Boolean(orgId && !composing && !keywordTooLong && (!qualifier || repoScope));
  const issueKey = JSON.stringify([orgId, repoScope, keyword, issueRetry]);
  const issueResult = issues?.key === issueKey ? issues : undefined;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const input = inputRef.current;
    input?.focus();
    if (input) input.setSelectionRange(input.value.length, input.value.length);
    return () => dialog.close();
  }, []);

  useEffect(() => {
    if (!orgId) return;
    const request = new AbortController();
    void repositoryAPI.list(orgId, request.signal).then(({ items }) => {
      if (!request.signal.aborted) setRepositories({ key: repoKey, data: items });
    }, () => {
      if (!request.signal.aborted) setRepositories({ key: repoKey, failed: true });
    });
    return () => request.abort();
  }, [orgId, repoKey]);

  useEffect(() => {
    if (!canSearch || !keyword) return;
    const request = new AbortController();
    const timer = window.setTimeout(() => {
      void issuesAPI.list(orgId, { repository: repoScope, q: keyword, limit: previewLimit }, request.signal).then(page => {
        if (!request.signal.aborted) setIssues({ key: issueKey, data: page });
      }, () => {
        if (!request.signal.aborted) setIssues({ key: issueKey, failed: true });
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      request.abort();
    };
  }, [canSearch, orgId, repoScope, keyword, issueKey]);

  const issueList = canSearch && issueResult && "data" in issueResult ? issueResult.data.items : [];
  const repoMatches = qualifier || composing || keywordTooLong ? [] : repoList.filter(item => item.slug.toLowerCase().includes(needle));
  if (!needle) repoMatches.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const pages = qualifier || composing || keywordTooLong ? [] : navigationItems.filter(item => [item.label, t(labelToNavKey(item.label))].some(label => label.toLowerCase().includes(needle)));
  const suggestions = scopeNeedle !== undefined && qualifiers.length === 1 && !repoScope && !keywordTooLong
    ? repoList.filter(item => item.slug.toLowerCase().includes(scopeNeedle)).slice(0, previewLimit) : [];
  const issuesPath = repoScope ? repositoryPath(handle, repoScope, "issues") : orgPath(handle, "issues");
  const issueParams = new URLSearchParams(keyword ? { q: keyword, state: "all" } : { state: "all" });
  // ponytail: the Changeset keyword endpoint scans candidates; reserve it for submit until search is indexed.
  const changesetParams = new URLSearchParams({ q: keyword });
  if (repoScope) changesetParams.set("repository", repoScope);
  const groups: { name: string; options: Option[]; compact?: boolean }[] = [
    { name: t("commandPalette.repositorySearch"), compact: true, options: [
      ...suggestions.map(item => ({ id: `suggest-${item.slug}`, label: `repo:${item.slug}`, repository: item.slug, icon: Book, action: t("commandPalette.useRepository"), query: `repo:${item.slug} ${keyword}` })),
      ...(repoScope && !keyword ? [{ id: "search-repo", label: `repo:${repoScope}`, repository: repoScope, icon: Search, action: t("commandPalette.searchRepository"), href: `${issuesPath}?${issueParams}` }] : []),
      ...(qualifier ? [{ id: "search-workspace", label: t("commandPalette.searchWorkspace"), icon: Search, query: qualifiers.length === 1 ? keyword : "" }] : []),
    ] },
    { name: t("commandPalette.recent"), options: keyword || qualifier || composing ? [] : recent.map(value => ({ id: `recent-${value}`, label: value, icon: Clock, query: value })) },
    { name: t("routes.repositories"), options: repoMatches.slice(0, previewLimit).map(item => ({ id: `repo-${item.slug}`, label: item.slug, icon: Book, href: repositoryPath(handle, item.slug) })) },
    { name: t("routes.issues"), options: issueList.map(issue => ({ id: `issue-${issue.id}`, label: issue.title, detail: `${issue.repository} #${issue.number}`, icon: CircleDot, href: issueDetailPath(handle, issue.repository, issue.number) })) },
    { name: t("commandPalette.pages"), options: (keyword ? pages : pages.slice(0, previewLimit)).map(item => ({ id: `page-${item.label}`, label: t(labelToNavKey(item.label)), icon: item.icon, href: itemHref(item, handle) })) },
    { name: t("commandPalette.searchActions"), options: keyword && canSearch ? [
      ...(repoScope || issueList.length ? [{ id: "all-issues", label: t("commandPalette.viewIssues"), icon: Search, href: `${issuesPath}?${issueParams}` }] : []),
      { id: "search-changesets", label: t("commandPalette.searchChangesets"), icon: GitCommitHorizontal, href: `${orgPath(handle, "changesets")}?${changesetParams}` },
    ] : [] },
  ];
  const options = groups.flatMap(group => group.options);
  const activeIndex = options.findIndex(option => option.id === activeId);
  const optionDomId = (index: number) => `${id}-option-${index}`;
  const repoFailed = repoResult && "failed" in repoResult;
  const issueFailed = canSearch && issueResult && "failed" in issueResult;
  const loading = Boolean(orgId && !composing && !keywordTooLong && (!repoResult || (canSearch && keyword && !issueResult)));
  const unknownRepo = qualifier && qualifiers.length === 1 && !repoScope && !suggestions.length && !loading && !repoFailed;
  const noMatches = !qualifier && !keywordTooLong && keyword && !loading && !repoFailed && !issueFailed && !repoMatches.length && !issueList.length && !pages.length;

  function changeQuery(value: string) {
    setQuery(value);
    setActiveId("");
  }

  function selectOption(option: Option) {
    if (option.query !== undefined) {
      changeQuery(option.query);
      inputRef.current?.focus();
    } else if (option.href) {
      const submittedQuery = query.trim();
      if (submittedQuery && orgId) {
        const next = [submittedQuery, ...recent.filter(item => item !== submittedQuery)].slice(0, previewLimit);
        try {
          window.localStorage.setItem(historyKey, JSON.stringify(next));
        } catch {
          // Storage can be unavailable. Navigation still works.
        }
      }
      onClose();
      navigateTo(option.href);
    }
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || composing || !options.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const start = activeIndex < 0 && direction < 0 ? 0 : activeIndex;
      const next = (start + direction + options.length) % options.length;
      setActiveId(options[next].id);
      document.getElementById(optionDomId(next))?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      // Wait for the preview before defaulting to a search action. Explicit selections still work.
      const option = activeIndex >= 0 ? options[activeIndex] : options.find(item => item.id !== "search-workspace");
      if (option && (activeIndex >= 0 || !loading)) selectOption(option);
    }
  }

  return (
    <dialog ref={dialogRef} className="command-palette" aria-label={t("commandPalette.title")}
      onCancel={event => { event.preventDefault(); if (!composing) onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="command-palette__panel">
        <div className="command-palette__header">
          <div className="command-palette__search">
            <Search size={18} aria-hidden="true" />
            <div className="command-palette__input">
              {scopeText && <div ref={highlightRef} className="command-palette__highlight" aria-hidden="true">
                <span>{query.slice(0, scopeStart)}<mark>{scopeText}</mark>{query.slice(scopeEnd)}</span>
              </div>}
              <Input ref={inputRef} controlSize="large" role="combobox" aria-label={t("commandPalette.title")} aria-autocomplete="list"
                autoComplete="off" aria-expanded="true" aria-controls={`${id}-results`} aria-activedescendant={activeIndex >= 0 ? optionDomId(activeIndex) : undefined}
                placeholder={t("commandPalette.placeholder")} value={query}
                onChange={event => changeQuery(event.target.value)} onKeyDown={onSearchKey}
                onScroll={event => { if (highlightRef.current) highlightRef.current.scrollLeft = event.currentTarget.scrollLeft; }}
                onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
            </div>
            {query && <Button variant="ghost" size="small" className="icon-button command-palette__clear" aria-label={t("commandPalette.clear")}
              onClick={() => { changeQuery(""); inputRef.current?.focus(); }}><X size={16} strokeWidth={3} aria-hidden="true" /></Button>}
          </div>
        </div>
        <div className="command-palette__results">
          <div id={`${id}-results`} role="listbox" aria-label={t("commandPalette.results")}>
            {groups.map(({ name, options: groupOptions, compact }, groupIndex) => groupOptions.length > 0 && (
              <div className={compact ? "command-palette__group command-palette__group--scope" : "command-palette__group"} role="group" aria-label={compact ? name : undefined}
                aria-labelledby={compact ? undefined : `${id}-group-${groupIndex}`} key={name}>
                {!compact && <div id={`${id}-group-${groupIndex}`} className="command-palette__group-label">{name}</div>}
                {groupOptions.map(option => (
                  <div key={option.id} id={optionDomId(options.indexOf(option))} role="option" aria-selected={option.id === activeId}
                    className="command-palette__item" onMouseDown={event => event.preventDefault()} onClick={() => selectOption(option)}>
                    <option.icon size={16} aria-hidden="true" />
                    <span className="command-palette__label"><span>{option.repository ? <>repo:<mark>{option.repository}</mark></> : option.label}</span>{option.detail && <small>{option.detail}</small>}</span>
                    {option.action ? <span className="command-palette__scope-action">{option.action}</span> : option.href && <span className="command-palette__action" aria-hidden="true">{t(option.id === "all-issues" ? "commandPalette.viewAll" : "commandPalette.jumpTo")}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {loading && <p className="command-palette__status" role="status">{t("commandPalette.loading")}</p>}
          {keywordTooLong && <p className="command-palette__status" role="status">{t("commandPalette.queryTooLong", { max: CHANGESET_QUERY_MAX })}</p>}
          {qualifiers.length > 1 && <p className="command-palette__status" role="status">{t("commandPalette.singleRepository")}</p>}
          {unknownRepo && !keywordTooLong && <p className="command-palette__status" role="status">{scopeText ? t("commandPalette.repositoryNotFound") : t("commandPalette.repositoryHint")}</p>}
          {noMatches && <p className="command-palette__status" role="status">{t("commandPalette.noResults")}</p>}
          {repoFailed && <div className="command-palette__status" role="status">{t("commandPalette.repositoriesFailed")} <Button variant="ghost" size="small" onClick={() => { inputRef.current?.focus(); setRepoRetry(value => value + 1); }}>{t("commandPalette.retry")}</Button></div>}
          {issueFailed && <div className="command-palette__status" role="status">{t("commandPalette.issuesFailed")} <Button variant="ghost" size="small" onClick={() => { inputRef.current?.focus(); setIssueRetry(value => value + 1); }}>{t("commandPalette.retry")}</Button></div>}
        </div>
        <div className="command-palette__footer">
          <span><kbd>↑</kbd> <kbd>↓</kbd> {t("commandPalette.navigate")}</span>
          <span><kbd>↵</kbd> {t("commandPalette.open")}</span>
          <Button variant="ghost" size="small" onClick={onClose}><kbd>Esc</kbd> {t("commandPalette.close")}</Button>
        </div>
      </div>
    </dialog>
  );
}
