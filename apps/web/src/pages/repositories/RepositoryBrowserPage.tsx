import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Code2, Copy, FileText, Folder, GitBranch, GitCommit, Link2, Tag, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { repositoryPreviewAPI, type OrganizationSummary, type RepositoryBlameLine, type RepositoryCommit, type RepositoryPreviewBlob, type RepositoryPreviewRefs, type RepositoryPreviewTree } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { formatDate, formatDateTime, formatRelativeTime } from "../../shared/i18n/format";
import { organizationHandle, orgPath, webIDEPath } from "../../shared/routing";
import { Button, Input, Select } from "../../shared/ui";
import { RepositoryDiffViewer } from "./RepositoryDiffViewer";
import { RepositoryReadme } from "./RepositoryReadme";
import { RepositorySourceViewer } from "./RepositorySourceViewer";
import { formatRepositoryFileSize } from "./repositoryFileUtils";
import "./repositories.css";

type Props = { organization: OrganizationSummary; repository: string; onNotify: (message: string) => void };
type BrowseProps = { organizationID: string; repository: string; refName: string; makeQuery: (params: Record<string, string>) => string };

export function RepositoryBrowserPage({ organization, repository, onNotify }: Props) {
  const { t } = useTranslation("repositories");
  const [search, setSearch] = useSearchParams();
  const [refs, setRefs] = useState<RepositoryPreviewRefs>();
  const [refError, setRefError] = useState("");
  const [copyError, setCopyError] = useState("");
  const selectedRef = search.get("ref") || "";
  const snapshot = search.get("commit") || "";
  const change = search.get("change") || "";
  const compareBase = search.get("base") || "";
  const isHistory = search.get("view") === "commits" || Boolean(change);
  const file = search.get("path") || "";
  const directory = search.get("dir") || (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "");
  const refName = snapshot || selectedRef;
  const handle = organizationHandle(organization);
  const [owner, name] = repository.split("/");
  const author = search.get("author") || "";
  const day = search.get("day") || "";

  useEffect(() => {
    let active = true;
    void repositoryPreviewAPI.refs(organization.id, repository)
      .then(result => { if (active) setRefs(result); })
      .catch(cause => { if (active) setRefError(translateError(cause, t, "repositories:browser.refsFailed")); });
    return () => { active = false; };
  }, [organization.id, repository, t]);

  const makeQuery = (params: Record<string, string>) => {
    const query = new URLSearchParams();
    const filters = params.view === "commits" && change ? { author, day } : {};
    for (const [key, value] of Object.entries({ ref: selectedRef, commit: snapshot, ...filters, ...params })) {
      if (value) query.set(key, value);
    }
    return `?${query}`;
  };
  const copy = async (text: string, message: string) => {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(text);
      onNotify(message);
    } catch (cause) {
      setCopyError(translateError(cause, t, "repositories:browser.copyFailed"));
    }
  };
  const copyPermalink = (sha: string, anchor?: string) => {
    const url = new URL(window.location.href);
    if (!change) url.search = makeQuery({ commit: sha, dir: directory, path: file, view: isHistory ? "commits" : "", author, day });
    if (anchor) url.hash = anchor;
    return copy(url.toString(), t("repositories:feedback.permalinkCopied"));
  };
  const browse = { organizationID: organization.id, repository, refName, makeQuery };
  const refValue = (ref: RepositoryPreviewRefs["items"][number]) => `refs/${ref.kind === "branch" ? "heads" : "tags"}/${ref.name}`;
  const currentRef = refs?.items.find(ref => refValue(ref) === selectedRef)
    ?? refs?.items.find(ref => ref.name === (selectedRef || refs.default_branch));
  const referencePicker = <div className="repo-reference">
    {refs && refs.items.length > 0 && <Select aria-label={t("repositories:preview.refAriaLabel")} value={currentRef ? refValue(currentRef) : ""}
      onChange={event => setSearch(makeQuery({ ref: event.target.value, commit: "", view: isHistory ? "commits" : "" }).slice(1))}
      options={refs.items.map(ref => ({ value: refValue(ref), label: ref.kind === "branch" ? t("repositories:preview.branchOption", { name: ref.name }) : t("repositories:preview.tagOption", { name: ref.name }) }))}/>}
    {snapshot && <span className="repo-meta" title={snapshot}>{t("repositories:preview.pinnedCommit", { commit: snapshot.slice(0, 12) })}</span>}
    {snapshot && <Link className="repo-back" to={makeQuery({ commit: "", view: isHistory ? "commits" : "" })}>{t("repositories:browser.backToBranch")}</Link>}
  </div>;
  return <section className="repo-layout repo-browser" aria-label={t("repositories:preview.ariaLabel")}>
    <header className="repo-masthead">
      <div className="repo-browser-heading">
        <div>
          <Link className="repo-back" to={orgPath(handle, "repositories")}>{t("repositories:browser.backToRepositories")}</Link>
          <h1 aria-label={repository}><span><span className="repo-owner">{owner} / </span>{name}</span></h1>
        </div>
        <Link className="af-button af-button--secondary af-button--middle" to={webIDEPath(handle, { repository, commit: change || snapshot || currentRef?.sha, path: file })}>{t("repositories:page.openWebide")}</Link>
      </div>
    </header>
    {refError && <p className="org-error" role="alert">{refError}</p>}
    {copyError && <p className="org-error" role="alert">{copyError}</p>}
    {change ? <CommitDetails key={`${change}:${compareBase}`} {...browse} change={change} base={compareBase} onCopy={anchor => void copyPermalink(change, anchor)}
      onCopySHA={sha => void copy(sha, t("repositories:browser.shaCopied"))} author={author} day={day}/>
      : isHistory ? <CommitHistory key={refName} {...browse} referencePicker={referencePicker} author={author} day={day}
        onFilter={(nextAuthor, nextDay) => setSearch(makeQuery({ view: "commits", author: nextAuthor, day: nextDay }).slice(1))}
        onCopy={copyPermalink} onCopySHA={sha => void copy(sha, t("repositories:browser.shaCopied"))}/>
      : <CodeBrowser key={`${refName}:${directory}:${file}`} {...browse} refs={refs} referencePicker={referencePicker}
        file={file} directory={directory} handle={handle} onCopy={copyPermalink}/>}
  </section>;
}

// ponytail: The history API caps results at 100. Add cursor paging on the server for older commits.
const historyLimit = 100;

function CommitHistory({ organizationID, repository, refName, makeQuery, referencePicker, author, day, onFilter, onCopy, onCopySHA }: BrowseProps & {
  referencePicker: React.ReactNode; author: string; day: string; onFilter: (author: string, day: string) => void;
  onCopy: (sha: string) => void; onCopySHA: (sha: string) => void;
}) {
  const { t } = useTranslation("repositories");
  const [history, setHistory] = useState<{ commit_sha: string; items: RepositoryCommit[] }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void repositoryPreviewAPI.history(organizationID, repository, refName, historyLimit)
      .then(result => { if (active) setHistory(result); })
      .catch(cause => { if (active) setError(translateError(cause, t, "repositories:feedback.historyFailed")); });
    return () => { active = false; };
  }, [organizationID, repository, refName, t]);

  const commits = history?.items ?? [];
  // Use the same local calendar date for the timeline and its filters.
  const dates = new Map(commits.map(commit => [new Date(commit.authored_at).toDateString(), formatDate(commit.authored_at)]));
  const groups = new Map<string, RepositoryCommit[]>();
  for (const commit of commits) {
    const commitDay = new Date(commit.authored_at).toDateString();
    if ((author && commit.author !== author) || (day && commitDay !== day)) continue;
    if (!groups.has(commitDay)) groups.set(commitDay, []);
    groups.get(commitDay)?.push(commit);
  }
  const authors = [...new Set(commits.map(commit => commit.author).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return <section className="repo-history" aria-labelledby="repo-history-title">
    <h2 id="repo-history-title" className="repo-view-title">{t("repositories:history.title")}</h2>
    <div className="repo-toolbar repo-history-toolbar">
      {referencePicker}
      {history && <div className="repo-toolbar repo-history-filters">
        <Select aria-label={t("repositories:browser.filterAuthor")} value={author} onChange={event => onFilter(event.target.value, day)}
          options={[{ value: "", label: t("repositories:browser.allAuthors") }, ...authors.map(name => ({ value: name, label: name }))]}/>
        <Select aria-label={t("repositories:browser.filterDate")} value={day} onChange={event => onFilter(author, event.target.value)}
          options={[{ value: "", label: t("repositories:browser.allDates") }, ...Array.from(dates, ([value, label]) => ({ value, label }))]}/>
        <Button size="small" onClick={() => onCopy(history.commit_sha)} aria-label={t("repositories:preview.copyPermalink")} title={t("repositories:preview.copyPermalink")}><Link2 size={16}/></Button>
      </div>}
    </div>
    {commits.length === historyLimit && <p className="repo-meta">{t("repositories:browser.historyLimit", { count: historyLimit })}</p>}
    {error ? <p className="org-error" role="alert">{error}</p> : !history ? <p className="repo-empty" role="status">{t("repositories:browser.historyLoading")}</p>
      : groups.size === 0 ? <p className="repo-empty">{t("repositories:browser.historyEmpty")}</p>
      : <div className="repo-timeline">{Array.from(groups, ([date, items]) => <div className="repo-timeline-group" key={date}>
        <h3><GitCommit size={18} aria-hidden="true"/>{t("repositories:browser.commitsOn", { date: dates.get(date) })}</h3>
        <ol className="repo-panel repo-rows">{items.map(commit => <li className="repo-row repo-history-row" key={commit.sha}>
          <div className="repo-row-main">
            <Link className="repo-link" to={makeQuery({ change: commit.sha, author, day })}>{commit.subject || t("repositories:history.noSubject")}</Link>
            <div className="repo-meta"><Button className="repo-text-button" variant="ghost" size="small" onClick={() => onFilter(commit.author, day)}>{commit.author}</Button>
              <time dateTime={commit.authored_at} title={formatDateTime(commit.authored_at)}>{formatRelativeTime(commit.authored_at)}</time></div>
          </div>
          <div className="repo-history-actions">
            {commit.sha !== history.commit_sha && <Link className="repo-quiet-action" to={makeQuery({ change: history.commit_sha, base: commit.sha, author, day })}>{t("repositories:history.compareToCurrent")}</Link>}
            <div className="repo-sha-group">
              <Link className="repo-sha" to={makeQuery({ change: commit.sha, author, day })} title={commit.sha}>{commit.sha.slice(0, 7)}</Link>
              <Button size="small" variant="ghost" className="repo-diff-icon" aria-label={t("repositories:browser.copySHA", { sha: commit.sha.slice(0, 7) })} title={t("repositories:browser.copySHA", { sha: commit.sha.slice(0, 7) })} onClick={() => onCopySHA(commit.sha)}><Copy size={14} aria-hidden="true"/></Button>
            </div>
            <Link className="af-button af-button--secondary af-button--small repo-commit-icon-action" to={makeQuery({ commit: commit.sha })}
              aria-label={t("repositories:browser.browseAtCommit")} title={t("repositories:browser.browseAtCommit")}><Code2 size={15} aria-hidden="true"/></Link>
          </div>
        </li>)}</ol>
      </div>)}</div>}
  </section>;
}

function CommitDetails({ organizationID, repository, makeQuery, change, base, onCopy, onCopySHA, author, day }: BrowseProps & {
  change: string; base: string; onCopy: (anchor?: string) => void; onCopySHA: (sha: string) => void; author: string; day: string;
}) {
  const { t } = useTranslation("repositories");
  const [commit, setCommit] = useState<RepositoryCommit>();
  const [patch, setPatch] = useState<string>();
  const [error, setError] = useState("");
  const parent = base || commit?.parents[0] || "";
  useEffect(() => {
    let active = true;
    void repositoryPreviewAPI.history(organizationID, repository, change, 1)
      .then(result => {
        const item = result.items[0];
        if (!item || item.sha !== result.commit_sha) throw new Error(t("repositories:browser.commitMissing"));
        if (active) setCommit(item);
      })
      .catch(cause => { if (active) setError(translateError(cause, t, "repositories:feedback.historyFailed")); });
    return () => { active = false; };
  }, [organizationID, repository, change, t]);

  useEffect(() => {
    if (!commit) return;
    let active = true;
    void repositoryPreviewAPI.compare(organizationID, repository, parent, commit.sha)
      .then(result => { if (active) setPatch(result.patch); })
      .catch(cause => { if (active) setError(translateError(cause, t, "repositories:feedback.compareFailed")); });
    return () => { active = false; };
  }, [organizationID, repository, parent, commit, t]);

  return <section className="repo-commit-detail" aria-label={t("repositories:compare.ariaLabel")}>
    <Link className="repo-back" to={makeQuery({ view: "commits" })}>{t("repositories:browser.backToHistory")}</Link>
    <header className="repo-commit-heading">
      <h2>{base ? t("repositories:compare.title") : commit ? <>{t("repositories:diff.commit")} <code title={commit.sha}>{commit.sha.slice(0, 7)}</code></> : t("repositories:browser.commitDetails")}</h2>
      {commit && <div className="repo-toolbar">
        <Link className="af-button af-button--secondary af-button--small" title={t("repositories:browser.browseAtCommit")} to={makeQuery({ commit: commit.sha })}>{t("repositories:browser.browseAtCommit")}</Link>
        <Button size="small" variant="ghost" className="repo-diff-icon" onClick={() => onCopy()} aria-label={t("repositories:preview.copyPermalink")} title={t("repositories:preview.copyPermalink")}><Link2 size={15} aria-hidden="true"/></Button>
      </div>}
    </header>
    {commit && <div className="repo-meta repo-commit-author"><UserRound size={15} aria-hidden="true"/><strong>{commit.author}</strong><time dateTime={commit.authored_at} title={formatDateTime(commit.authored_at)}>{formatRelativeTime(commit.authored_at)}</time></div>}
    {commit && <div className="repo-panel repo-commit-card">
      <h3 className="repo-commit-subject">{commit.subject || t("repositories:history.noSubject")}</h3>
      <div className="repo-toolbar repo-commit-metadata repo-meta">
        {base ? <span>{t("repositories:compare.range", { base: base.slice(0, 12), head: commit.sha.slice(0, 12) })}</span>
          : commit.parents.map(sha => <Link key={sha} className="repo-quiet-action" to={makeQuery({ change: sha, author, day })}>
            {t("repositories:browser.parentCommit")}: <code title={sha}>{sha.slice(0, 7)}</code>
          </Link>)}
        <span className="repo-commit-identity">{t("repositories:browser.commitSHA")} <code title={commit.sha}>{commit.sha.slice(0, 7)}</code>
          <Button size="small" variant="ghost" className="repo-diff-icon" aria-label={t("repositories:browser.copySHA", { sha: commit.sha.slice(0, 7) })} title={t("repositories:browser.copySHA", { sha: commit.sha.slice(0, 7) })} onClick={() => onCopySHA(commit.sha)}><Copy size={15}/></Button>
        </span>
      </div>
    </div>}
    {error ? <p className="org-error" role="alert">{error}</p> : !commit || patch === undefined ? <p className="repo-empty" role="status">{t("repositories:browser.commitLoading")}</p>
      : patch ? <RepositoryDiffViewer patch={patch}/> : <p className="repo-empty">{t("repositories:compare.noChanges")}</p>}
  </section>;
}

function CodeBrowser({ organizationID, repository, refName, makeQuery, directory, file, handle, onCopy, refs, referencePicker }: BrowseProps & {
  refs?: RepositoryPreviewRefs; referencePicker: React.ReactNode; directory: string; file: string; handle: string; onCopy: (sha: string) => void;
}) {
  const { t } = useTranslation("repositories");
  const navigate = useNavigate();
  const [tree, setTree] = useState<RepositoryPreviewTree>();
  const [latestCommit, setLatestCommit] = useState<RepositoryCommit>();
  const [blob, setBlob] = useState<RepositoryPreviewBlob>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const [readmeError, setReadmeError] = useState("");
  const segments = directory ? directory.split("/") : [];
  const isRoot = !directory && !file;
  const sha = tree?.commit_sha || blob?.commit_sha || "";
  const visibleEntries = (tree?.items ?? []).filter(entry => entry.name.toLowerCase().includes(query.trim().toLowerCase())).sort((left, right) => {
    if ((left.kind === "tree") !== (right.kind === "tree")) return left.kind === "tree" ? -1 : 1;
    if (sort === "size" && left.size !== undefined && right.size !== undefined && left.size !== right.size) return right.size - left.size;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });

  useEffect(() => {
    let active = true;
    if (file) {
      void repositoryPreviewAPI.blob(organizationID, repository, file, refName)
        .then(result => { if (active) setBlob(result); })
        .catch(cause => { if (active) setError(translateError(cause, t, "repositories:feedback.sourceFailed")); });
    } else {
      void repositoryPreviewAPI.tree(organizationID, repository, directory, refName)
        .then(async result => {
          if (!active) return;
          setTree(result);
          if (directory) return;
          const readme = result.items.find(entry => entry.kind === "file" && /^readme(?:\.md|\.markdown)?$/i.test(entry.name));
          if (!readme) return;
          try {
            const content = await repositoryPreviewAPI.blob(organizationID, repository, readme.path, result.commit_sha);
            if (active) setBlob(content);
          } catch (cause) {
            if (active) setReadmeError(translateError(cause, t, "repositories:feedback.readmeFailed"));
          }
        })
        .catch(cause => { if (active) setError(translateError(cause, t, "repositories:feedback.treeFailed")); });
    }
    return () => { active = false; };
  }, [organizationID, repository, directory, file, refName, t]);

  useEffect(() => {
    if (!tree?.commit_sha) return;
    let active = true;
    void repositoryPreviewAPI.history(organizationID, repository, tree.commit_sha, 1)
      .then(result => { if (active && result.items[0]?.sha === tree.commit_sha) setLatestCommit(result.items[0]); })
      .catch(() => { /* Directory navigation still works if commit metadata is unavailable. */ });
    return () => { active = false; };
  }, [organizationID, repository, tree?.commit_sha]);

  return <div className={isRoot ? "repo-overview" : undefined}>
    <div className="repo-code-main">
      <div className="repo-toolbar repo-code-toolbar">
        <div className="repo-toolbar">
          {referencePicker}
          {isRoot && refs && <span className="repo-ref-summary">
            <span><GitBranch size={15}/>{t("repositories:browser.branches", { count: refs.items.filter(ref => ref.kind === "branch").length })}</span>
            <span><Tag size={15}/>{t("repositories:browser.tags", { count: refs.items.filter(ref => ref.kind === "tag").length })}</span>
          </span>}
        </div>
        {!file && <div className="repo-toolbar repo-file-controls">
          <Input type="search" aria-label={t("repositories:browser.filterFiles")} placeholder={t("repositories:browser.filterFiles")} value={query} onChange={event => setQuery(event.target.value)}/>
          <Select aria-label={t("repositories:browser.sortFiles")} value={sort} onChange={event => setSort(event.target.value)} options={[{ value: "name", label: t("repositories:browser.sortName") }, { value: "size", label: t("repositories:browser.sortSize") }]}/>
        </div>}
        {file && sha && <Button size="small" onClick={() => onCopy(sha)} aria-label={t("repositories:preview.copyPermalink")} title={t("repositories:preview.copyPermalink")}><Link2 size={15} aria-hidden="true"/></Button>}
      </div>
      {!isRoot && <nav className="repo-breadcrumbs" aria-label={t("repositories:preview.pathAriaLabel")}>
        <Link to={makeQuery({})}>{t("repositories:preview.root")}</Link>
        {segments.map((segment, index) => <span key={index}>/ <Link to={makeQuery({ dir: segments.slice(0, index + 1).join("/") })}>{segment}</Link></span>)}
        {file && <span>/ <strong>{file.split("/").at(-1)}</strong></span>}
      </nav>}
    {error && <p className="org-error" role="alert">{error}</p>}
    {!tree && !blob && !error && <p className="repo-empty" role="status">{t("repositories:preview.loading")}</p>}
    {tree && <section className="repo-panel" aria-label={t("repositories:browser.files")}>
      <header className="repo-panel-header repo-latest-commit">
        <div className="repo-row-main">
          {latestCommit ? <><span className="repo-latest-author"><UserRound size={16}/>{latestCommit.author}</span>
            <Link className="repo-link" to={makeQuery({ change: sha })}>{latestCommit.subject || t("repositories:history.noSubject")}</Link></> : <h2>{t("repositories:browser.files")}</h2>}
        </div>
        <div className="repo-toolbar">
          {latestCommit && <time className="repo-meta" dateTime={latestCommit.authored_at} title={formatDateTime(latestCommit.authored_at)}>{formatRelativeTime(latestCommit.authored_at)}</time>}
          <Link className="repo-sha" to={makeQuery({ change: sha })} title={sha}>{sha.slice(0, 7)}</Link>
          <Button size="small" aria-label={t("repositories:preview.copyPermalink")} title={t("repositories:preview.copyPermalink")} onClick={() => onCopy(sha)}><Link2 size={15}/></Button>
          <Link className="repo-link repo-history-entry" to={makeQuery({ view: "commits" })}>{t("repositories:history.title")}</Link>
        </div>
      </header>
      <ul className="repo-rows">
        {directory && <li className="repo-row"><Link className="repo-link" to={makeQuery({ dir: segments.slice(0, -1).join("/") })}>{t("repositories:preview.parent")}</Link></li>}
        {visibleEntries.map(entry => <li className="repo-row repo-file-row" key={entry.path}>
          <div className="repo-row-main">
            {entry.kind === "tree" || entry.kind === "file" ? <Link className="repo-link" to={makeQuery(entry.kind === "tree" ? { dir: entry.path } : { dir: directory, path: entry.path })}>
              {entry.kind === "tree" ? <Folder size={17} className="repo-folder-icon" aria-hidden="true"/> : <FileText size={16} aria-hidden="true"/>}{entry.name}
            </Link> : <span className="repo-meta">{entry.name} · {entry.kind === "symlink" ? t("repositories:preview.kindSymlink") : t("repositories:preview.kindBlob")}</span>}
          </div>
          {entry.size !== undefined && <span className="repo-meta">{formatRepositoryFileSize(entry.size)}</span>}
        </li>)}
        {!visibleEntries.length && <li className="repo-empty">{tree.items.length ? t("repositories:preview.noMatch", { query }) : t("repositories:preview.emptyDirectory")}</li>}
      </ul>
    </section>}
    {readmeError && <p className="repo-meta" role="status">{readmeError}</p>}
    {blob && <section id={file ? undefined : "repository-readme"} className={file ? "repo-panel repo-file-content" : "repo-panel repo-file-content repo-readme"} aria-label={file || t("repositories:preview.readmeAriaLabel")}>
      <header className="repo-panel-header"><h2>{file ? blob.path : "README"}</h2>
        {file && <Link className="af-button af-button--secondary af-button--small" to={webIDEPath(handle, { repository, commit: sha, path: blob.path })}>{t("repositories:file.openInWebIDE")}</Link>}
      </header>
      {file && <FileInspection organizationID={organizationID} repository={repository} blob={blob} makeQuery={makeQuery}/>}
      <div className="repo-file-body">
        {!file || /\.md$|\.markdown$/i.test(blob.path) ? <RepositoryReadme content={blob.content} sourcePath={blob.path}
          onOpenPath={path => navigate(makeQuery({ path, commit: sha }))}
          onOpenImage={path => repositoryPreviewAPI.imageURL(organizationID, repository, path, sha)}/>
          : <RepositorySourceViewer content={blob.content} path={blob.path}/>}
      </div>
    </section>}
    </div>
    {isRoot && <aside className="repo-about" aria-labelledby="repo-about-title">
      <h2 id="repo-about-title">{t("repositories:browser.about")}</h2>
      <dl>
        <div><dt>{t("repositories:columns.repository")}</dt><dd>{repository}</dd></div>
        {refs && <div><dt>{t("repositories:form.branchLabel")}</dt><dd>{refs.default_branch}</dd></div>}
      </dl>
      <div className="repo-about-links">
        {blob && <a className="repo-quiet-action" href="#repository-readme">README</a>}
        <Link className="repo-quiet-action" to={makeQuery({ view: "commits" })}>{t("repositories:history.title")}</Link>
      </div>
    </aside>}
  </div>;
}

function FileInspection({ organizationID, repository, blob, makeQuery }: {
  organizationID: string; repository: string; blob: RepositoryPreviewBlob; makeQuery: BrowseProps["makeQuery"];
}) {
  const { t } = useTranslation("repositories");
  const [kind, setKind] = useState<"history" | "blame">();
  const [items, setItems] = useState<RepositoryCommit[]>();
  const [lines, setLines] = useState<RepositoryBlameLine[]>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inspect = async (next: "history" | "blame") => {
    setKind(next);
    setError("");
    setLoading(true);
    try {
      if (next === "history") setItems((await repositoryPreviewAPI.fileHistory(organizationID, repository, blob.path, blob.commit_sha)).items);
      else setLines((await repositoryPreviewAPI.blame(organizationID, repository, blob.path, blob.commit_sha)).items);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:feedback.inspectionFailed"));
    } finally { setLoading(false); }
  };
  return <div className="repo-inspection">
    <div className="repo-toolbar">
      <Button size="small" onClick={() => void inspect("history")} disabled={loading}>{t("repositories:file.historyButton")}</Button>
      <Button size="small" onClick={() => void inspect("blame")} disabled={loading}>{t("repositories:file.blameButton")}</Button>
    </div>
    {loading ? <p role="status">{t("repositories:file.loadingInspection")}</p> : error ? <p className="org-error" role="alert">{error}</p>
      : kind === "history" && items ? <section aria-label={t("repositories:file.historyAriaLabel")}>
        <h3>{t("repositories:file.historyTitle")}</h3>
        {items.length ? <ul className="repo-rows">{items.map(commit => <li className="repo-row" key={commit.sha}>
          <Link className="repo-link repo-row-main" to={makeQuery({ change: commit.sha })}>{commit.subject || t("repositories:history.noSubject")}</Link><code>{commit.sha.slice(0, 7)}</code>
        </li>)}</ul> : <p className="repo-meta">{t("repositories:browser.historyEmpty")}</p>}
      </section> : kind === "blame" && lines ? <section aria-label={t("repositories:file.blameAriaLabel")}>
        <h3>{t("repositories:file.blameTitle")}</h3>
        {lines.length ? <div className="repo-blame">{lines.map(line => <div className="repo-row" key={line.line}>
          <code>{line.line}</code><Link className="repo-sha" to={makeQuery({ change: line.commit_sha })}>{line.commit_sha.slice(0, 7)}</Link><span>{line.author}</span><code>{line.content}</code>
        </div>)}</div> : <p className="repo-meta">{t("repositories:browser.blameEmpty")}</p>}
      </section> : null}
  </div>;
}
