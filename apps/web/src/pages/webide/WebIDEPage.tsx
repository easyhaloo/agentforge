import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ChevronLeft, Code2, FileText, Folder, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  changesetAPI,
  repositoryAPI,
  repositoryPreviewAPI,
  type OrganizationSummary,
  type RepositoryMetadata,
  type RepositoryPreviewBlob,
  type RepositoryPreviewEntry,
  type RepositoryPreviewRef,
  type RepositoryPreviewTree,
  type StoredChangeset,
} from "../../shared/api/identity";
import { Button, Select, TextArea } from "../../shared/ui";

export function WebIDEPage({ organization }: { organization: OrganizationSummary }) {
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const [repositories, setRepositories] = useState<RepositoryMetadata[]>([]);
  const [changesets, setChangesets] = useState<StoredChangeset[]>([]);
  const [selectedRepository, setSelectedRepository] = useState(initial.get("repository") ?? "");
  const [selectedChangesetID, setSelectedChangesetID] = useState(initial.get("changeset") ?? "");
  const [refs, setRefs] = useState<RepositoryPreviewRef[]>([]);
  const [selectedRef, setSelectedRef] = useState(initial.get("commit") ?? initial.get("ref") ?? "");
  const [directory, setDirectory] = useState("");
  const [tree, setTree] = useState<RepositoryPreviewTree | null>(null);
  const [selectedPath, setSelectedPath] = useState(initial.get("path") ?? "");
  const [activeLine] = useState(() => Math.max(0, Number(initial.get("line") ?? 0) || 0));
  const [file, setFile] = useState<RepositoryPreviewBlob | null>(null);
  const [draft, setDraft] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const selectedChangeset = changesets.find(item => item.changeset.id === selectedChangesetID);
  const dirty = Boolean(file && draft !== original);

  const confirmDiscard = () => !dirty || window.confirm("Discard unsaved changes and continue?");
  const selectFile = (path: string) => {
    if (!confirmDiscard()) return;
    setSelectedPath(path);
    setError("");
    setConflict(false);
  };

  useEffect(() => {
    let active = true;
    void repositoryAPI.list(organization.id).then(result => {
      if (!active) return;
      setRepositories(result.items);
      setSelectedRepository(current => current || result.items[0]?.slug || "");
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load repositories"); });
    void changesetAPI.list(organization.id).then(result => {
      if (!active) return;
      setChangesets(result.items);
      setSelectedChangesetID(current => current || result.items[0]?.changeset.id || "");
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load changesets"); });
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
      if (active) {
        setFile(result);
        setOriginal(result.content);
        setDraft(result.content);
        setError("");
        setConflict(false);
      }
    }).catch(cause => { if (active) { setFile(null); setError(cause instanceof Error ? cause.message : "Unable to open source file"); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, selectedRepository, selectedRef, selectedPath]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedRepository) url.searchParams.set("repository", selectedRepository);
    if (selectedRef) url.searchParams.set("commit", selectedRef);
    if (selectedChangesetID) url.searchParams.set("changeset", selectedChangesetID);
    if (selectedPath) url.searchParams.set("path", selectedPath);
    else url.searchParams.delete("path");
    if (activeLine) url.searchParams.set("line", String(activeLine));
    window.history.replaceState(window.history.state, "", url);
  }, [selectedRepository, selectedRef, selectedChangesetID, selectedPath, activeLine]);

  const entries = tree?.items ?? [];
  const openEntry = (entry: RepositoryPreviewEntry) => {
    if (entry.kind === "tree") {
      if (!confirmDiscard()) return;
      setDirectory(entry.path);
      setSelectedPath("");
    } else if (entry.kind === "file") selectFile(entry.path);
  };
  const refOptions = [
    ...(selectedRef && !refs.some(ref => ref.name === selectedRef) ? [{ value: selectedRef, label: "Pinned commit · " + selectedRef.slice(0, 12) }] : []),
    ...refs.map(ref => ({ value: ref.name, label: (ref.kind === "branch" ? "Branch · " : "Tag · ") + ref.name })),
  ];
  const changesetOptions = changesets.filter(item => item.changeset.repository === selectedRepository).map(item => ({
    value: item.changeset.id,
    label: item.changeset.title + " · " + item.status,
  }));

  const chooseChangeset = (id: string) => {
    if (!confirmDiscard()) return;
    const next = changesets.find(item => item.changeset.id === id);
    setSelectedChangesetID(id);
    setDirectory("");
    setSelectedPath("");
    setFile(null);
    const revision = next?.changeset.revisions.at(-1);
    if (revision?.commit_sha) setSelectedRef(revision.commit_sha);
  };

  const save = async () => {
    if (!file || !selectedChangeset || !dirty || saving) return;
    setSaving(true);
    setError("");
    setConflict(false);
    try {
      const result = await changesetAPI.saveFile(organization.id, selectedChangeset.changeset.id, {
        path: file.path,
        base_commit_sha: file.commit_sha,
        base_blob_sha: file.blob_sha,
        content: draft,
      });
      setChangesets(current => current.map(item => item.changeset.id === result.changeset.changeset.id ? result.changeset : item));
      setSelectedRef(result.commit_sha);
      setOriginal(draft);
      setError("Saved as a new Changeset revision.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to save file";
      setError(message);
      setConflict(/409|conflict|stale/i.test(message));
    } finally {
      setSaving(false);
    }
  };

  return <section className="webide-page">
    <header className="webide-heading">
      <div><span className="eyebrow">DEVELOPER WORKSPACE</span><h2><Code2 size={20}/> WebIDE</h2><p>Commit-pinned editor · changeset-isolated write-back</p></div>
      <span className="webide-mode">{selectedChangeset ? "CHANGESET EDIT" : "READ ONLY"}</span>
    </header>
    <section className="card webide-toolbar">
      <Select aria-label="Repository" value={selectedRepository} onChange={event => {
        if (!confirmDiscard()) return;
        const nextRepository = event.target.value;
        setSelectedRepository(nextRepository);
        const nextChangeset = changesets.find(item => item.changeset.repository === nextRepository);
        setSelectedChangesetID(nextChangeset?.changeset.id ?? "");
        const revision = nextChangeset?.changeset.revisions.at(-1);
        setSelectedRef(revision?.commit_sha ?? "");
        setDirectory(""); setSelectedPath(""); setTree(null); setFile(null);
      }} options={repositories.map(repo => ({ value: repo.slug, label: repo.slug }))} />
      <Select aria-label="Changeset" value={selectedChangesetID} onChange={event => chooseChangeset(event.target.value)} options={changesetOptions}/>
      <Select aria-label="Branch, tag, or pinned commit" value={selectedRef} onChange={event => {
        if (!confirmDiscard()) return;
        setSelectedRef(event.target.value); setDirectory(""); setSelectedPath(""); setFile(null);
      }} options={refOptions}/>
      <Button className="button secondary" onClick={() => {
        if (!confirmDiscard()) return;
        setDirectory(""); setSelectedPath(""); setFile(null);
      }}><RefreshCw size={14}/> Reset</Button>
    </section>
    {error && <div className={conflict ? "org-error" : "webide-notice"} role={conflict ? "alert" : "status"}>{conflict && <AlertCircle size={14}/>} {error}</div>}
    {loading && <p role="status">Loading repository content…</p>}
    <div className="webide-layout">
      <aside className="card webide-explorer" aria-label="Repository explorer">
        <div className="webide-explorer__title"><strong>Explorer</strong><span>{entries.length} items</span></div>
        <div className="webide-breadcrumb"><Button className="button link" onClick={() => { if (confirmDiscard()) { setDirectory(""); setSelectedPath(""); } }}>root</Button>{directory.split("/").filter(Boolean).map((part, index, parts) => <span key={index}> / <Button className="button link" onClick={() => { if (confirmDiscard()) { setDirectory(parts.slice(0,index+1).join("/")); setSelectedPath(""); } }}>{part}</Button></span>)}</div>
        {directory && <Button className="button secondary" onClick={() => { if (confirmDiscard()) setDirectory(directory.split("/").slice(0,-1).join("/")); }}><ChevronLeft size={13}/> Parent</Button>}
        <ul>{entries.map(entry => <li key={entry.path}><Button className="button link" disabled={entry.kind !== "tree" && entry.kind !== "file"} onClick={() => openEntry(entry)}>{entry.kind === "tree" ? <Folder size={14}/> : <FileText size={14}/>} {entry.name}</Button></li>)}</ul>
      </aside>
      <section className="card webide-editor" aria-label="Text editor">
        {file ? <>
          <div className="webide-editor__title">
            <div><strong>{file.path}</strong><span>{file.commit_sha.slice(0,12)} · blob {file.blob_sha.slice(0,8)}</span></div>
            <div className="webide-editor__actions">
              <Button className="button secondary" disabled={!dirty || saving} onClick={() => { setDraft(original); setError(""); setConflict(false); }}><Trash2 size={13}/> Discard</Button>
              <Button className="button primary" disabled={!selectedChangeset || !dirty || saving} onClick={() => void save()}>{saving ? <RefreshCw size={13}/> : <Save size={13}/>} {saving ? "Saving…" : "Save revision"}</Button>
            </div>
          </div>
          {!selectedChangeset && <p className="webide-hint">Select a Changeset for isolated editing. The repository branch remains read-only.</p>}
          {dirty && <p className="webide-hint">Unsaved changes · Save creates a new commit on the Changeset branch, never on the default branch.</p>}
          <TextArea aria-label="File content" value={draft} onChange={event => setDraft(event.target.value)} rows={24} disabled={!selectedChangeset || saving}/>
          {dirty && <details className="webide-diff"><summary>Review changes ({draft.split("\n").length} current lines)</summary><pre>{draft.split("\n").map((line, index) => <span key={index}>+ {line}\n</span>)}</pre></details>}
          {conflict && <div className="webide-conflict"><AlertCircle size={15}/> Your buffer is preserved. Reload the latest Changeset revision and reapply your edits before saving again.</div>}
        </> : <div className="webide-empty"><Code2 size={28}/><strong>Select a file to edit</strong><span>Choose a Changeset to enable safe text editing. Writes are isolated to its dedicated branch.</span></div>}
      </section>
    </div>
  </section>;
}
