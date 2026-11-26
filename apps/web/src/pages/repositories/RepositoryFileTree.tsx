import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PanelLeft, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../shared/api/errors";
import { repositoryPreviewAPI, type RepositoryPreviewEntry } from "../../shared/api/identity";
import { Button, Input, Popover } from "../../shared/ui";
import "./RepositoryFileTree.css";

type FileNavigation =
  | { fileHref: (path: string) => string; onSelectFile?: never }
  | { fileHref?: never; onSelectFile: (path: string, size?: number) => void };

type TreeProps = FileNavigation & {
  organizationID: string;
  repository: string;
  refName: string;
  selectedFile?: string;
};

export function RepositoryFileTree({ referencePicker, referenceDetails, workspaceHref, ...tree }: TreeProps & {
  referencePicker?: ReactNode;
  referenceDetails?: ReactNode;
  workspaceHref?: string;
}) {
  const { t } = useTranslation("repositories");
  const [open, setOpen] = useState(false);
  const panelID = useId();

  return <aside className="repo-file-nav">
    <Button className="repo-file-nav-toggle" variant="secondary" size="small" aria-expanded={open} aria-controls={panelID} onClick={() => setOpen(!open)}>
      <PanelLeft size={16} aria-hidden="true"/>{t("browser.files")}
    </Button>
    <div id={panelID} className="repo-file-nav-panel" data-open={open}>
      <h2>{t("browser.files")}</h2>
      <div className="repo-file-nav-toolbar">
        <div className="repo-file-nav-reference">{referencePicker}</div>
        <div className="repo-file-nav-actions">
          {workspaceHref && <Popover ariaLabel={t("preview.create")} triggerClassName="af-button repo-file-nav-action"
            trigger={<><Plus size={16} aria-hidden="true"/><span className="repo-file-nav-action-label">{t("preview.create")}</span></>}>
            {dismiss => <Link className="af-button af-button--ghost af-action-row repo-file-nav-workspace" to={workspaceHref} onClick={dismiss}>
              {t("workspace.create")}
            </Link>}
          </Popover>}
          <Popover ariaLabel={t("preview.searchFolder")} triggerClassName="af-button repo-file-nav-action"
            trigger={<><Search size={16} aria-hidden="true"/><span className="repo-file-nav-action-label">{t("preview.searchFolder")}</span></>}>
            {dismiss => <FileSearch {...tree} dismiss={dismiss}/>}
          </Popover>
        </div>
      </div>
      {referenceDetails}
      <nav aria-label={t("preview.fileTree")}>
        <TreeDirectory {...tree} path="" depth={0} expanded />
      </nav>
    </div>
  </aside>;
}

function FileSearch({ dismiss, ...tree }: TreeProps & { dismiss: () => void }) {
  const { t } = useTranslation("repositories");
  const [query, setQuery] = useState("");
  const path = tree.selectedFile?.split("/").slice(0, -1).join("/") ?? "";
  return <>
    <Input type="search" aria-label={t("preview.searchFolder")} placeholder={t("preview.searchFolder")}
      value={query} onChange={event => setQuery(event.target.value)}/>
    <div className="repo-file-nav-search-results">
      <TreeDirectory {...tree} key={path} path={path} depth={0} expanded search={{ query, dismiss }}/>
    </div>
  </>;
}

function TreeDirectory({ path, depth, expanded, search, ...tree }: TreeProps & {
  path: string; depth: number; expanded: boolean; search?: { query: string; dismiss: () => void };
}) {
  const { t } = useTranslation("repositories");
  const { organizationID, repository, refName } = tree;
  const [entries, setEntries] = useState<RepositoryPreviewEntry[]>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!expanded || entries) return;
    let active = true;
    void repositoryPreviewAPI.tree(organizationID, repository, path, refName)
      .then(result => {
        if (!active) return;
        setError("");
        setEntries(result.items ?? []);
      })
      .catch(cause => {
        if (active) setError(translateError(cause, t, "repositories:feedback.treeFailed"));
      });
    return () => { active = false; };
  }, [expanded, entries, organizationID, repository, path, refName, t, attempt]);

  if (!expanded && !entries?.length) return null;
  if (error) return <div className="repo-file-nav-status">
    <p role="alert">{error}</p>
    <Button variant="secondary" size="small" onClick={() => { setError(""); setAttempt(value => value + 1); }}>{t("common:actions.retry")}</Button>
  </div>;
  if (!entries) return <p className="repo-file-nav-status" role="status">{t("preview.loadingTree")}</p>;
  if (!entries.length) return <p className="repo-file-nav-status" role="status">{t("preview.emptyDirectory")}</p>;

  const query = search?.query.trim().toLowerCase() ?? "";
  const sortedEntries = [...entries].filter(entry => !search || (entry.kind === "file" && entry.name.toLowerCase().includes(query))).sort((left, right) =>
    Number(right.kind === "tree") - Number(left.kind === "tree") || left.name.localeCompare(right.name));
  if (!sortedEntries.length) return <p className="repo-file-nav-status" role="status">{
    query ? t("preview.noMatch", { query: search?.query.trim() }) : t("preview.noFilesInFolder")
  }</p>;
  return <ul hidden={!expanded} style={{ "--file-tree-indent": `${depth * 8}px` } as CSSProperties}>
    {sortedEntries.map(entry => <FileTreeItem key={entry.path} entry={entry} depth={depth} onNavigate={search?.dismiss} {...tree}/>)}
  </ul>;
}

function FileTreeItem({ entry, depth, onNavigate, ...tree }: TreeProps & {
  entry: RepositoryPreviewEntry; depth: number; onNavigate?: () => void;
}) {
  const [expanded, setExpanded] = useState<boolean>();
  const isOpen = expanded ?? Boolean(tree.selectedFile?.startsWith(`${entry.path}/`));
  const current = tree.selectedFile === entry.path ? "true" : undefined;
  const fileLabel = <><FileTreeIcon name="file"/><span>{entry.name}</span></>;
  if (entry.kind === "tree") return <li>
    <Button variant="ghost" className="af-action-row file-tree-item folder" aria-expanded={isOpen} onClick={() => setExpanded(!isOpen)}>
      <FileTreeIcon name={isOpen ? "chevron-down" : "chevron-right"}/>
      <FileTreeIcon name={isOpen ? "file-directory-open-fill" : "file-directory-fill"} className="file-tree-folder-icon"/>
      <span>{entry.name}</span>
    </Button>
    <TreeDirectory {...tree} path={entry.path} depth={depth + 1} expanded={isOpen}/>
  </li>;
  if (entry.kind !== "file") return <li><span className="file-tree-item" aria-disabled="true">{fileLabel}</span></li>;
  return <li>{tree.fileHref
    ? <Link className="file-tree-item" to={tree.fileHref(entry.path)} onClick={onNavigate} aria-current={current}>{fileLabel}</Link>
    : <Button variant="ghost" className="af-action-row file-tree-item" onClick={() => { onNavigate?.(); tree.onSelectFile?.(entry.path, entry.size); }} aria-current={current}>{fileLabel}</Button>}
  </li>;
}

// Primer Octicons (MIT). See apps/web/THIRD_PARTY_NOTICES.txt.
const iconPaths = {
  "chevron-right": "M4.7 10c-.2 0-.4-.1-.5-.2-.3-.3-.3-.8 0-1.1L6.9 6 4.2 3.3c-.3-.3-.3-.8 0-1.1.3-.3.8-.3 1.1 0l3.3 3.2c.3.3.3.8 0 1.1L5.3 9.7c-.2.2-.4.3-.6.3Z",
  "chevron-down": "M6 8.825c-.2 0-.4-.1-.5-.2l-3.3-3.3c-.3-.3-.3-.8 0-1.1.3-.3.8-.3 1.1 0l2.7 2.7 2.7-2.7c.3-.3.8-.3 1.1 0 .3.3.3.8 0 1.1l-3.2 3.2c-.2.2-.4.3-.6.3Z",
  "file-directory-fill": "M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z",
  "file-directory-open-fill": "M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1H13a1 1 0 0 1 1 1v.5H2.75a.75.75 0 0 0 0 1.5h11.978a1 1 0 0 1 .994 1.117L15 13.25A1.75 1.75 0 0 1 13.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.91.513-1.237Z",
  "file": "M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z",
};

function FileTreeIcon({ name, className }: { name: keyof typeof iconPaths; className?: string }) {
  const size = name.startsWith("chevron-") ? 12 : 16;
  return <svg className={className} width={size} height={size} viewBox={`0 0 ${size} ${size}`}
    fill="currentColor" aria-hidden="true" focusable="false">
    <path d={iconPaths[name]}/>
  </svg>;
}
