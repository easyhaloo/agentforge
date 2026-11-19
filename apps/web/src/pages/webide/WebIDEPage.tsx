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
import { Button, Select } from "../../shared/ui";
import { RepositorySourceViewer } from "../repositories/RepositorySourceViewer";

export function WebIDEPage({ organization }: { organization: OrganizationSummary }) {
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
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load repositories"); });
    return () => { active = false; };
  }, [organization.id]);

  useEffect(() => {
    if (!selectedRepository) { setRefs([]); return; }
    let active = true;
    void repositoryPreviewAPI.refs(organization.id, selectedRepository).then(result => {
      if (!active) return;
      setRefs(result.items);
      setSelectedRef(current => current || result.default_branch);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load repository refs"); });
    return () => { active = false; };
  }, [organization.id, selectedRepository]);

  useEffect(() => {
    if (!selectedRepository || !selectedRef) return;
    let active = true;
    setLoading(true);
    void repositoryPreviewAPI.tree(organization.id, selectedRepository, directory, selectedRef).then(result => {
      if (active) setTree(result);
    }).catch(cause => { if (active) { setTree(null); setError(cause instanceof Error ? cause.message : "Unable to load repository tree"); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, selectedRepository, selectedRef, directory]);

  useEffect(() => {
    if (!selectedRepository || !selectedRef || !selectedPath) { setFile(null); return; }
    let active = true;
    setLoading(true);
    void repositoryPreviewAPI.blob(organization.id, selectedRepository, selectedPath, selectedRef).then(result => {
      if (active) { setFile(result); setError(""); }
    }).catch(cause => { if (active) { setFile(null); setError(cause instanceof Error ? cause.message : "Unable to open source file"); } })
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
    ...(selectedRef && !refs.some(ref => ref.name === selectedRef) ? [{ value: selectedRef, label: "Pinned commit · " + selectedRef.slice(0, 12) }] : []),
    ...refs.map(ref => ({ value: ref.name, label: (ref.kind === "branch" ? "Branch · " : "Tag · ") + ref.name })),
  ];

  return <section className="webide-page">
    <header className="webide-heading">
      <div><span className="eyebrow">DEVELOPER WORKSPACE</span><h2><Code2 size={20}/> WebIDE</h2><p>Repository-aware source workspace · read-only preview</p></div>
      <span className="webide-mode">READ ONLY</span>
    </header>
    <section className="card webide-toolbar">
      <Select aria-label="Repository" value={selectedRepository} onChange={event => { setSelectedRepository(event.target.value); setSelectedRef(""); setDirectory(""); setSelectedPath(""); setTree(null); setFile(null); }} options={repositories.map(repo => ({ value: repo.slug, label: repo.slug }))} />
      <Select aria-label="Branch, tag, or pinned commit" value={selectedRef} onChange={event => { setSelectedRef(event.target.value); setDirectory(""); setSelectedPath(""); setFile(null); }} options={refOptions}/>
      <Button className="button secondary" onClick={() => { setDirectory(""); setSelectedPath(""); setFile(null); }}><RefreshCw size={14}/> Reset</Button>
    </section>
    {error && <div className="org-error" role="alert">{error}</div>}
    {loading && <p role="status">Loading repository content…</p>}
    <div className="webide-layout">
      <aside className="card webide-explorer" aria-label="Repository explorer">
        <div className="webide-explorer__title"><strong>Explorer</strong><span>{entries.length} items</span></div>
        <div className="webide-breadcrumb"><Button className="button link" onClick={() => { setDirectory(""); setSelectedPath(""); }}>root</Button>{directory.split("/").filter(Boolean).map((part, index, parts) => <span key={index}> / <Button className="button link" onClick={() => { setDirectory(parts.slice(0,index+1).join("/")); setSelectedPath(""); }}>{part}</Button></span>)}</div>
        {directory && <Button className="button secondary" onClick={() => setDirectory(directory.split("/").slice(0,-1).join("/"))}><ChevronLeft size={13}/> Parent</Button>}
        <ul>{entries.map(entry => <li key={entry.path}><Button className="button link" disabled={entry.kind !== "tree" && entry.kind !== "file"} onClick={() => openEntry(entry)}>{entry.kind === "tree" ? <Folder size={14}/> : <FileText size={14}/>} {entry.name}</Button></li>)}</ul>
      </aside>
      <section className="card webide-editor" aria-label="Editor preview">
        {file ? <><div className="webide-editor__title"><strong>{file.path}</strong><span>{file.commit_sha.slice(0,12)}</span></div><RepositorySourceViewer path={file.path} content={file.content} activeLine={activeLine}/></>
          : <div className="webide-empty"><Code2 size={28}/><strong>Select a file to preview</strong><span>Choose a repository file from the explorer. Editing and write-back are not enabled.</span></div>}
      </section>
    </div>
  </section>;
}
