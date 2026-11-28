import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { changesetAPI, type OrganizationSummary, type StoredChangeset } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { usePersistentState } from "../../shared/hooks/usePersistentState";
import { Button, Input, TextArea } from "../../shared/ui";
import { getDiffFileId, getDiffFilePath, RepositoryDiffViewer } from "../repositories/RepositoryDiffViewer";
import { PullRequestConversationResolution } from "./PullRequestConversationResolution";
import { PullRequestFileTree } from "./PullRequestFileTree";
import type { RepositoryDiffFile } from "../repositories/repositoryDiff";

const NARROW_VIEWPORT = "(max-width: 760px)";
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 480;
const clampSidebarWidth = (width: number) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));

type Anchor = { path: string; side: "left" | "right"; line: number };
type Props = {
  files: RepositoryDiffFile[];
  organization: OrganizationSummary;
  changeset: StoredChangeset;
  pullNumber: string;
  onUpdate: (changeset: StoredChangeset) => void;
  memberName: (id: string) => string;
};

export function PullRequestFilesTab({ files, organization, changeset, pullNumber, onUpdate, memberName }: Props) {
  const { t } = useTranslation(["pulls", "common"]);
  const sidebarID = useId();
  const [filter, setFilter] = useState("");
  const [selectedPath, setSelectedPath] = useState<string>();
  const [sidebarHidden, setSidebarHidden] = usePersistentState("agentforge:pulls:filesSidebarHidden", false);
  const [storedWidth, setStoredWidth] = usePersistentState("agentforge:pulls:filesSidebarWidth", DEFAULT_SIDEBAR_WIDTH);
  const [dragWidth, setDragWidth] = useState<number>();
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const sidebarWidth = dragWidth ?? (Number.isFinite(storedWidth) ? clampSidebarWidth(storedWidth) : DEFAULT_SIDEBAR_WIDTH);
  const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(() => new Set());
  const [preferredView, setPreferredView] = useState<"unified" | "split">("unified");
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW_VIEWPORT).matches ?? false);
  const viewMode = narrow ? "unified" : preferredView;
  const [anchor, setAnchor] = useState<Anchor>();
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLButtonElement | null>(null);
  const revision = changeset.changeset.revisions.at(-1);
  const canWrite = organization.role !== "viewer";
  const comments = changeset.changeset.pull_request?.comments ?? [];
  const query = sidebarHidden ? "" : filter.trim().toLowerCase();
  const visibleFiles = useMemo(() => query ? files.filter(file =>
    getDiffFilePath(file).toLowerCase().includes(query)) : files, [files, query]);
  const totals = useMemo(() => files.reduce((total, file) => ({
    additions: total.additions + file.additions, deletions: total.deletions + file.deletions,
  }), { additions: 0, deletions: 0 }), [files]);

  useEffect(() => {
    const media = window.matchMedia?.(NARROW_VIEWPORT);
    if (!media) return;
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    if (anchor) composer.current?.focus();
    else {
      restoreFocus.current?.focus();
      restoreFocus.current = null;
    }
  }, [anchor, viewMode]);

  const selectFile = (path: string) => {
    setSelectedPath(path);
    setCollapsedFiles(current => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });
    requestAnimationFrame(() => {
      const patch = document.getElementById(getDiffFileId(path));
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      patch?.scrollIntoView?.({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
      patch?.querySelector("summary")?.focus({ preventScroll: true });
    });
  };

  const toggleFile = (path: string) => setCollapsedFiles(current => {
    const next = new Set(current);
    if (!next.delete(path)) next.add(path);
    return next;
  });

  const closeComposer = () => {
    restoreFocus.current = trigger.current;
    setAnchor(undefined);
    setBody("");
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!revision || !anchor || !body.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      onUpdate(await changesetAPI.addPullRequestComment(organization.id, pullNumber, body.trim(), revision.id, anchor.path, anchor.side, anchor.line));
      closeComposer();
    } catch (cause) { setError(translateError(cause, t, "pulls:conversation.commentFailed")); }
    finally { setSaving(false); }
  };

  return <div className="pull-files-tab" style={{ "--pull-sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
    <div className="pull-files-toolbar">
      <div className="pull-files-summary">
        {t("pulls:files.count", { count: files.length })}{", "}
        <span className="pull-file-additions">{t("pulls:files.additions", { count: totals.additions })}</span>{" "}
        <span className="pull-file-deletions">{t("pulls:files.deletions", { count: totals.deletions })}</span>
      </div>
      <Button size="small" aria-controls={sidebarID} aria-expanded={!sidebarHidden} disabled={!!anchor} onClick={() => setSidebarHidden(!sidebarHidden)}>
        {sidebarHidden ? t("pulls:files.showFiles") : t("pulls:files.hideFiles")}
      </Button>
      <Button size="small" disabled={!!anchor || !files.length || collapsedFiles.size === files.length}
        onClick={() => setCollapsedFiles(new Set(files.map(getDiffFilePath)))}>{t("pulls:files.collapseAll")}</Button>
      <Button size="small" disabled={!collapsedFiles.size} onClick={() => setCollapsedFiles(new Set())}>{t("pulls:files.expandAll")}</Button>
      <div className="pull-files-view-mode" role="group" aria-label={t("pulls:files.viewMode")}>
        <Button size="small" aria-pressed={viewMode === "unified"} onClick={() => setPreferredView("unified")}>{t("pulls:files.unified")}</Button>
        <Button size="small" aria-pressed={viewMode === "split"} disabled={narrow} onClick={() => setPreferredView("split")}>{t("pulls:files.split")}</Button>
      </div>
    </div>
    <aside id={sidebarID} className="pull-file-index" hidden={sidebarHidden}>
      <Input disabled={!!anchor} label={t("pulls:files.filterFiles")} value={filter} onChange={event => setFilter(event.target.value)}/>
      {visibleFiles.length > 0 && <PullRequestFileTree files={visibleFiles} selectedPath={selectedPath} onSelect={selectFile}/>}
    </aside>
    <div className="pull-files-resize" role="separator" tabIndex={0} hidden={sidebarHidden || narrow}
      aria-label={t("pulls:files.resizeSidebar")} aria-controls={sidebarID} aria-orientation="vertical"
      aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={MAX_SIDEBAR_WIDTH} aria-valuenow={sidebarWidth}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, width: sidebarWidth };
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (start?.pointer === event.pointerId) setDragWidth(clampSidebarWidth(start.width + event.clientX - start.x));
      }}
      onPointerUp={event => {
        const start = drag.current;
        if (start?.pointer !== event.pointerId) return;
        setStoredWidth(clampSidebarWidth(start.width + event.clientX - start.x));
        drag.current = null;
        setDragWidth(undefined);
      }}
      onLostPointerCapture={() => { drag.current = null; setDragWidth(undefined); }}
      onKeyDown={event => {
        const widths: Record<string, number> = {
          ArrowLeft: sidebarWidth - 10, ArrowRight: sidebarWidth + 10, Home: MIN_SIDEBAR_WIDTH, End: MAX_SIDEBAR_WIDTH,
        };
        if (!Object.hasOwn(widths, event.key)) return;
        event.preventDefault();
        setStoredWidth(clampSidebarWidth(widths[event.key]));
      }}/>
    <div className="pull-file-patches">
      {!visibleFiles.length && <p role="status">{query ? t("pulls:files.noMatchingFiles") : t("pulls:files.noFiles")}</p>}
      {visibleFiles.length > 0 && <RepositoryDiffViewer files={visibleFiles} viewMode={viewMode}
        collapsedFiles={collapsedFiles} lockedFile={anchor?.path} onToggleFile={toggleFile}
        lineControl={!canWrite || !revision ? undefined : (path, side, line) =>
          <Button variant="ghost" className="pull-line-action" disabled={!!anchor}
            ref={anchor?.path === path && anchor.side === side && anchor.line === line ? trigger : undefined}
            aria-label={`${t("pulls:conversation.addLineComment")} · ${path} · ${t(`pulls:files.${side}`)} ${line}`}
            onClick={() => setAnchor({ path, side, line })}>{line}</Button>}
        lineDiscussion={(path, side, line) => <>
          {comments.filter(comment => comment.revision_id === revision?.id && comment.path === path && comment.side === side && comment.line === line).map(comment =>
            <article className="pull-line-comment" key={comment.id}>
              <strong>{memberName(comment.author)} · {t(`pulls:files.${side}`)} {line}</strong>
              <p>{comment.body}</p>
              <PullRequestConversationResolution comment={comment} memberName={memberName} canWrite={canWrite}
                organizationID={organization.id} pullNumber={pullNumber} onUpdate={onUpdate} />
            </article>)}
          {anchor?.path === path && anchor.side === side && anchor.line === line &&
            <form className="pull-inline-composer" onSubmit={submit} onKeyDown={event => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing && !saving) {
                event.stopPropagation();
                closeComposer();
              }
            }}>
              <h3>{path} · {t(`pulls:files.${side}`)} {line}</h3>
              <TextArea ref={composer} label={t("pulls:conversation.writeComment")} placeholder={t("pulls:conversation.commentPlaceholder")} value={body} maxLength={10000} onChange={event => setBody(event.target.value)}/>
              {error && <p role="alert">{error}</p>}
              <div className="org-actions">
                <Button disabled={saving || !body.trim()} type="submit">{t("pulls:conversation.submitComment")}</Button>
                <Button disabled={saving} onClick={closeComposer}>{t("common:actions.cancel")}</Button>
              </div>
            </form>}
        </>}/>}
    </div>
  </div>;
}
