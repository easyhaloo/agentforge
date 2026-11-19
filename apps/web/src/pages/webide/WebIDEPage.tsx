import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Code2, FileText, Folder, RefreshCw } from "lucide-react";
import {
  repositoryAPI,
  repositoryPreviewAPI,
  type OrganizationSummary,
  type RepositoryMetadata,
  type RepositoryPreviewBlob,
  type RepositoryPreviewEntry,
  type RepositoryPreviewRef,
  type RepositoryPreviewTree,
} from "../../shared/api/identity";
import { useTranslation } from "react-i18next";
import { Button, Select } from "../../shared/ui";
import { translateError } from "../../shared/api/errors";
import { RepositorySourceViewer } from "../repositories/RepositorySourceViewer";

export function WebIDEPage({ organization }: { organization: OrganizationSummary }) {
  const { t } = useTranslation("repositories");
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const [repositories, setRepositories] = useState<RepositoryMetadata[]>([]);
  const [selectedRepository, setSelectedRepository] = useState(initial.get("repository") ?? "");
  const [refs, setRefs] = useState<RepositoryPreviewRef[]>([]);
  const [selectedRef, setSelectedRef] = useState(initial.get("commit") ?? initial.get("ref") ?? "");
  const [directory, setDirectory] = useState("");
  const [tree, setTree] = useState<RepositoryPreviewTree | null>(null);
  const [selectedPath, setSelectedPath] = useState(initial.get("path") ?? "");
  const [activeLine] = useState(() => Math.max(0, Number(initial.get("line") ?? 0) || 0));
  const [file, setFile] = useState<RepositoryPreviewBlob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void repositoryAPI.list(organization.id).then(result => {
      if (!active) return;
      setRepositories(result.items);
      setSelectedRepository(current => current || result.items[0]?.slug || "");
    }).catch(cause => { if (active) setError(translateError(cause, t, "repositories:webide.errors.repositoriesFailed")); });
    return () => { active = false; };
  }, [organization.id]);

  useEffect(() => {
    if (!selectedRepository) { setRefs([]); return; }
    let active = true;
    void repositoryPreviewAPI.refs(organization.id, selectedRepository).then(result => {
      if (!active) return;
      setRefs(result.items);
      setSelectedRef(current => current || result.default_branch);
    }).catch(cause => { if (active) setError(translateError(cause, t, "repositories:webide.errors.refsFailed")); });
    return () => { active = false; };
  }, [organization.id, selectedRepository]);

  useEffect(() => {
    if (!selectedRepository || !selectedRef) return;
    let active = true;
    setLoading(true);
    void repositoryPreviewAPI.tree(organization.id, selectedRepository, directory, selectedRef).then(result => {
      if (active) setTree(result);
    }).catch(cause => { if (active) { setTree(null); setError(translateError(cause, t, "repositories:webide.errors.treeFailed")); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, selectedRepository, selectedRef, directory]);

  useEffect(() => {
    if (!selectedRepository || !selectedRef || !selectedPath) { setFile(null); return; }
    let active = true;
    setLoading(true);
    void repositoryPreviewAPI.blob(organization.id, selectedRepository, selectedPath, selectedRef).then(result => {
      if (active) { setFile(result); setError(""); }
    }).catch(cause => { if (active) { setFile(null); setError(translateError(cause, t, "repositories:webide.errors.fileFailed")); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, selectedRepository, selectedRef, selectedPath]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedRepository) url.searchParams.set("repository", selectedRepository);
    if (selectedRef) url.searchParams.set("commit", selectedRef);
    if (selectedPath) url.searchParams.set("path", selectedPath);
    else url.searchParams.delete("path");
    if (activeLine) url.searchParams.set("line", String(activeLine));
    window.history.replaceState(window.history.state, "", url);
  }, [selectedRepository, selectedRef, selectedPath, activeLine]);

  const entries = tree?.items ?? [];
  const openEntry = (entry: RepositoryPreviewEntry) => {
    if (entry.kind === "tree") { setDirectory(entry.path); setSelectedPath(""); }
    else if (entry.kind === "file") setSelectedPath(entry.path);
  };
  const refOptions = [
    ...(selectedRef && !refs.some(ref => ref.name === selectedRef) ? [{ value: selectedRef, label: t("repositories:webide.pinnedCommit", { ref: selectedRef.slice(0, 12) }) }] : []),
    ...refs.map(ref => ({ value: ref.name, label: t(ref.kind === "branch" ? "repositories:webide.branchOption" : "repositories:webide.tagOption", { ref: ref.name }) })),
  ];

  return <section className="webide-page">
    <header className="webide-heading">
      <div><span className="eyebrow">{t("repositories:webide.eyebrow")}</span><h2><Code2 size={20}/> WebIDE</h2><p>{t("repositories:webide.description")}</p></div>
      <span className="webide-mode">{t("repositories:webide.readOnly")}</span>
    </header>
    <section className="card webide-toolbar">
      <Select aria-label={t("repositories:webide.repositoryAriaLabel")} value={selectedRepository} onChange={event => { setSelectedRepository(event.target.value); setSelectedRef(""); setDirectory(""); setSelectedPath(""); setTree(null); setFile(null); }} options={repositories.map(repo => ({ value: repo.slug, label: repo.slug }))} />
      <Select aria-label={t("repositories:webide.refAriaLabel")} value={selectedRef} onChange={event => { setSelectedRef(event.target.value); setDirectory(""); setSelectedPath(""); setFile(null); }} options={refOptions}/>
      <Button className="button secondary" onClick={() => { setDirectory(""); setSelectedPath(""); setFile(null); }}><RefreshCw size={14}/> {t("repositories:webide.reset")}</Button>
    </section>
    {error && <div className="org-error" role="alert">{error}</div>}
    {loading && <p role="status">{t("repositories:webide.loading")}</p>}
    <div className="webide-layout">
      <aside className="card webide-explorer" aria-label={t("repositories:webide.explorerAriaLabel")}>
        <div className="webide-explorer__title"><strong>{t("repositories:webide.explorer")}</strong><span>{t("repositories:webide.itemCount", { count: entries.length })}</span></div>
        <div className="webide-breadcrumb"><Button className="button link" onClick={() => { setDirectory(""); setSelectedPath(""); }}>{t("repositories:webide.root")}</Button>{directory.split("/").filter(Boolean).map((part, index, parts) => <span key={index}> / <Button className="button link" onClick={() => { setDirectory(parts.slice(0,index+1).join("/")); setSelectedPath(""); }}>{part}</Button></span>)}</div>
        {directory && <Button className="button secondary" onClick={() => setDirectory(directory.split("/").slice(0,-1).join("/"))}><ChevronLeft size={13}/> {t("repositories:webide.parent")}</Button>}
        <ul>{entries.map(entry => <li key={entry.path}><Button className="button link" disabled={entry.kind !== "tree" && entry.kind !== "file"} onClick={() => openEntry(entry)}>{entry.kind === "tree" ? <Folder size={14}/> : <FileText size={14}/>} {entry.name}</Button></li>)}</ul>
      </aside>
      <section className="card webide-editor" aria-label={t("repositories:webide.editorAriaLabel")}>
        {file ? <><div className="webide-editor__title"><strong>{file.path}</strong><span>{file.commit_sha.slice(0,12)}</span></div><RepositorySourceViewer path={file.path} content={file.content} activeLine={activeLine}/></>
          : <div className="webide-empty"><Code2 size={28}/><strong>{t("repositories:webide.emptyTitle")}</strong><span>{t("repositories:webide.emptyDescription")}</span></div>}
      </section>
    </div>
  </section>;
}
