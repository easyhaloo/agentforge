import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, Code2, FileText, Folder, GitCommit, GitCompare, Plus, RefreshCw, X } from "lucide-react";
import {
  repositoryAPI,
  repositoryPreviewAPI,
  type OrganizationSummary,
  type RepositoryMetadata,
  type RepositoryCommit,
  type RepositoryPreviewBlob,
  type RepositoryPreviewEntry,
  type RepositoryPreviewRef,
  type RepositoryPreviewTree,
} from "../../shared/api/identity";
import { Button, DataTable, Input, Select } from "../../shared/ui";
import { RepositoryReadme } from "./RepositoryReadme";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };

/** Registered repositories and a zero-clone, read-only source browser. */
export function RepositoriesPage({ organization, onNotify }: Props) {
  const [items, setItems] = useState<RepositoryMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [slug, setSlug] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [selectedRepository, setSelectedRepository] = useState(() => new URLSearchParams(window.location.search).get("repository") ?? "");
  const [directory, setDirectory] = useState("");
  const [tree, setTree] = useState<RepositoryPreviewTree | null>(null);
  const [previewCommit, setPreviewCommit] = useState(() => new URLSearchParams(window.location.search).get("commit") ?? "");
  const initialPermalinkPath = useRef(new URLSearchParams(window.location.search).get("path") ?? "");
  const [selectedFile, setSelectedFile] = useState<RepositoryPreviewBlob | null>(null);
  const [history, setHistory] = useState<RepositoryCommit[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [fileHistory, setFileHistory] = useState<RepositoryCommit[]>([]);
  const [blameLines, setBlameLines] = useState<import("../../shared/api/identity").RepositoryBlameLine[]>([]);
  const [fileInspectionError, setFileInspectionError] = useState("");
  const [fileInspectionLoading, setFileInspectionLoading] = useState(false);
  const [comparePatch, setComparePatch] = useState("");
  const [compareBase, setCompareBase] = useState("");
  const [compareError, setCompareError] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [repositoryRefs, setRepositoryRefs] = useState<RepositoryPreviewRef[]>([]);
  const [selectedRef, setSelectedRef] = useState("");
  const [defaultBranchName, setDefaultBranchName] = useState("");
  const canRegister = organization.role === "owner" || organization.role === "admin";

  useEffect(() => {
    if (!selectedRepository) { setRepositoryRefs([]); setSelectedRef(""); setDefaultBranchName(""); return; }
    let active = true;
    void repositoryPreviewAPI.refs(organization.id, selectedRepository).then(result => { if (active) { setRepositoryRefs(result.items); setDefaultBranchName(result.default_branch); } }).catch(() => { if (active) setRepositoryRefs([]); });
    return () => { active = false; };
  }, [organization.id, selectedRepository]);

  useEffect(() => {
    if (!selectedRepository) {
      const url = new URL(window.location.href);
      url.searchParams.delete("repository"); url.searchParams.delete("commit"); url.searchParams.delete("path");
      window.history.replaceState(window.history.state, "", url);
      return;
    }
    if (!previewCommit) return;
    const url = new URL(window.location.href);
    url.searchParams.set("repository", selectedRepository);
    url.searchParams.set("commit", previewCommit);
    const path = selectedFile?.path || directory;
    if (path) url.searchParams.set("path", path); else url.searchParams.delete("path");
    window.history.replaceState(window.history.state, "", url);
  }, [selectedRepository, previewCommit, selectedFile?.path, directory]);

  useEffect(() => {
    if (!tree || !selectedRepository || !previewCommit || !initialPermalinkPath.current || selectedFile) return;
    const path = initialPermalinkPath.current;
    initialPermalinkPath.current = "";
    void repositoryPreviewAPI.blob(organization.id, selectedRepository, path, previewCommit)
      .then(setSelectedFile)
      .catch(cause => setPreviewError(cause instanceof Error ? cause.message : "Unable to open permalink"));
  }, [organization.id, selectedRepository, previewCommit, tree, selectedFile]);

  const copyPermalink = async () => {
    if (!selectedRepository || !previewCommit) return;
    const url = new URL(window.location.href);
    url.searchParams.set("repository", selectedRepository);
    url.searchParams.set("commit", previewCommit);
    const path = selectedFile?.path || directory;
    if (path) url.searchParams.set("path", path); else url.searchParams.delete("path");
    await navigator.clipboard.writeText(url.toString());
    onNotify("Commit-pinned permalink copied.");
  };

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      setItems((await repositoryAPI.list(organization.id)).items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load repositories");
    } finally { setLoading(false); }
  }, [organization.id]);
  useEffect(() => { void load(); }, [load]);

  const loadTree = useCallback(async () => {
    if (!selectedRepository) return;
    setPreviewLoading(true); setPreviewError(""); setSelectedFile(null);
    try {
      const result = await repositoryPreviewAPI.tree(organization.id, selectedRepository, directory, previewCommit || selectedRef);
      setTree(result);
      if (!previewCommit) setPreviewCommit(result.commit_sha);
    } catch (cause) {
      setTree(null);
      setPreviewError(cause instanceof Error ? cause.message : "Unable to load repository tree");
    } finally { setPreviewLoading(false); }
  }, [organization.id, selectedRepository, directory, previewCommit, selectedRef]);
  useEffect(() => { void loadTree(); }, [loadTree]);

  useEffect(() => {
    if (!selectedRepository || !previewCommit) { setHistory([]); return; }
    let active = true;
    setHistoryError("");
    void repositoryPreviewAPI.history(organization.id, selectedRepository, previewCommit)
      .then(result => { if (active) setHistory(result.items); })
      .catch(cause => { if (active) setHistoryError(cause instanceof Error ? cause.message : "Unable to load commit history"); });
    return () => { active = false; };
  }, [organization.id, selectedRepository, previewCommit]);

  const inspectFile = async (kind: "history" | "blame") => {
    if (!selectedRepository || !selectedFile) return;
    setFileInspectionLoading(true); setFileInspectionError("");
    try {
      if (kind === "history") {
        const result = await repositoryPreviewAPI.fileHistory(organization.id, selectedRepository, selectedFile.path, previewCommit);
        setFileHistory(result.items);
        setBlameLines([]);
      } else {
        const result = await repositoryPreviewAPI.blame(organization.id, selectedRepository, selectedFile.path, previewCommit);
        setBlameLines(result.items);
        setFileHistory([]);
      }
    } catch (cause) {
      setFileInspectionError(cause instanceof Error ? cause.message : "Unable to inspect file history");
    } finally { setFileInspectionLoading(false); }
  };

  const compareToCurrent = async (baseCommit: string) => {
    if (!selectedRepository || !previewCommit || baseCommit === previewCommit) return;
    setCompareLoading(true); setCompareError(""); setComparePatch(""); setCompareBase(baseCommit);
    try {
      const result = await repositoryPreviewAPI.compare(organization.id, selectedRepository, baseCommit, previewCommit);
      setComparePatch(result.patch);
    } catch (cause) {
      setCompareError(cause instanceof Error ? cause.message : "Unable to compare commits");
    } finally { setCompareLoading(false); }
  };

  const register = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const added = await repositoryAPI.register(organization.id, slug.trim(), defaultBranch.trim());
      setItems(current => [...current, added]);
      setSlug("");
      onNotify("Repository registered.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Repository registration failed");
    } finally { setBusy(false); }
  };

  const openEntry = async (entry: RepositoryPreviewEntry) => {
    if (entry.kind === "tree") {
      setDirectory(entry.path);
      return;
    }
    if (entry.kind !== "file") return;
    setFileHistory([]); setBlameLines([]); setFileInspectionError("");
    setPreviewLoading(true); setPreviewError(""); setSelectedFile(null);
    try {
      setSelectedFile(await repositoryPreviewAPI.blob(organization.id, selectedRepository, entry.path, previewCommit));
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "Unable to read source file");
    } finally { setPreviewLoading(false); }
  };

  return <section className="org-admin">
    <div className="org-admin-summary card">
      <div className="org-admin-summary__icon"><Code2 size={19}/></div>
      <div><h2>Registered repositories</h2><p>Repositories this organization may create changesets in</p></div>
      <span className="org-role">{organization.role}</span>
      <Button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/> Refresh</Button>
    </div>
    {error && <div className="org-error" role="alert">{error}</div>}
    {canRegister && <form className="org-invite-form" onSubmit={register}>
      <Input label="Repository slug" required pattern="[^/]+/[^/]+" value={slug} onChange={event => setSlug(event.target.value)} placeholder="team/repository"/>
      <Input label="Default branch" required value={defaultBranch} onChange={event => setDefaultBranch(event.target.value)} placeholder="main"/>
      <Button className="button primary" type="submit" disabled={busy}><Plus size={14}/> Register</Button>
    </form>}
    {!canRegister && <p className="changeset-hint">Only organization owners and admins can register a repository.</p>}
    <DataTable
      className="org-table"
      columns={[
        { key: "slug", title: "REPOSITORY", render: (_value, item) => <Button className="button link" onClick={() => { initialPermalinkPath.current = ""; setSelectedRepository(item.slug); setSelectedRef(item.default_branch); setDirectory(""); setSelectedFile(null); setPreviewCommit(""); }}><Code2 size={14}/>{item.slug}</Button> },
        { key: "default_branch", title: "DEFAULT BRANCH" },
        { key: "created_by", title: "REGISTERED BY" },
        { key: "created_at", title: "REGISTERED" },
      ]}
      data={items}
      rowKey="slug"
      loading={loading}
      emptyText="No repositories registered yet."
      showColumnVisibility={false}
    />
    {selectedRepository && <section className="card" aria-label="Repository preview" style={{ marginTop: 16, padding: 16 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div><h2 style={{ margin: 0 }}>Repository preview</h2><p style={{ margin: "4px 0 0" }}>{selectedRepository} · read-only, no clone required</p></div>
        <Select label="Ref" aria-label="Repository branch or tag" controlSize="small" value={selectedRef || defaultBranchName} onChange={event => { setSelectedRef(event.target.value); setPreviewCommit(""); setDirectory(""); setSelectedFile(null); setComparePatch(""); }} options={[...repositoryRefs.filter(ref => ref.kind === "branch").map(ref => ({ value: ref.name, label: `Branch · ${ref.name}` })), ...repositoryRefs.filter(ref => ref.kind === "tag").map(ref => ({ value: ref.name, label: `Tag · ${ref.name}` }))]} />
        <Button className="button secondary" onClick={() => void copyPermalink()} disabled={!previewCommit}>Copy permalink</Button>
        <Button className="button secondary" onClick={() => { setSelectedRepository(""); setTree(null); setSelectedFile(null); setPreviewCommit(""); }}><X size={14}/> Close</Button>
      </header>
      {tree && <p className="changeset-hint">Pinned commit: <code>{tree.commit_sha}</code></p>}
      {previewError && <div className="org-error" role="alert">{previewError}</div>}
      {historyError && <div className="org-error" role="alert">{historyError}</div>}
      {history.length > 0 && <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border-subtle, #ddd)", borderRadius: 6 }}>
        <h3 style={{ margin: "0 0 8px" }}>Commit history</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {history.map(commit => <li key={commit.sha} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <GitCommit size={15} style={{ marginTop: 3, flexShrink: 0 }}/>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Button className="button link" onClick={() => { setPreviewCommit(commit.sha); setDirectory(""); setSelectedFile(null); setComparePatch(""); }}>{commit.subject || "(no subject)"}</Button>
                {commit.sha !== previewCommit && <Button className="button secondary" onClick={() => void compareToCurrent(commit.sha)} disabled={compareLoading}><GitCompare size={13}/> Compare to current</Button>}
              </div>
              <div className="changeset-hint">{commit.author} · {new Date(commit.authored_at).toLocaleString()} · <code>{commit.sha.slice(0, 12)}</code></div>
            </div>
          </li>)}
        </ul>
      </div>}

      {compareError && <div className="org-error" role="alert">{compareError}</div>}
      {compareLoading && <p role="status">Comparing immutable commits…</p>}
      {comparePatch !== "" && <section aria-label="Commit comparison" style={{ marginTop: 12 }}>
        <h3>Commit comparison</h3>
        <p className="changeset-hint">Base commit <code>{compareBase.slice(0, 12)}</code> · head commit <code>{previewCommit.slice(0, 12)}</code></p>
        <pre style={{ overflow: "auto", maxHeight: 480, padding: 16, borderRadius: 6, background: "var(--surface-subtle, #f6f8fa)", whiteSpace: "pre" }}><code>{comparePatch || "No changes."}</code></pre>
      </section>}
      {previewLoading && <p role="status">Loading repository content…</p>}
      {!previewLoading && tree && !selectedFile && <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
          <Button className="button secondary" disabled={!directory} onClick={() => setDirectory(directory.split("/").slice(0, -1).join("/"))}><ChevronLeft size={14}/> Parent</Button>
          <code>/{tree.path}</code>
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {tree.items.map(entry => <li key={entry.path} style={{ borderTop: "1px solid var(--border-subtle, #ddd)", padding: "8px 4px" }}>
            <Button className="button link" disabled={entry.kind !== "tree" && entry.kind !== "file"} onClick={() => void openEntry(entry)}>
              {entry.kind === "tree" ? <Folder size={15}/> : <FileText size={15}/>}
              {entry.name}
            </Button>
            {entry.kind === "symlink" && <span className="changeset-hint"> · symbolic link (not followed)</span>}
          </li>)}
          {tree.items.length === 0 && <li className="changeset-hint">This directory is empty.</li>}
        </ul>
      </div>}
      {selectedFile && <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Button className="button secondary" onClick={() => setSelectedFile(null)}><ChevronLeft size={14}/> Back to files</Button>
          <strong>{selectedFile.path}</strong>
        </div>
        <p className="changeset-hint">Blob <code>{selectedFile.blob_sha}</code> · commit <code>{selectedFile.commit_sha}</code></p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
          <Button className="button secondary" onClick={() => void inspectFile("history")} disabled={fileInspectionLoading}>File history</Button>
          <Button className="button secondary" onClick={() => void inspectFile("blame")} disabled={fileInspectionLoading}>Blame</Button>
        </div>
        {fileInspectionLoading && <p role="status">Loading file inspection…</p>}
        {fileInspectionError && <div className="org-error" role="alert">{fileInspectionError}</div>}
        {fileHistory.length > 0 && <section aria-label="File history"><h3>File history</h3><ul>{fileHistory.map(commit => <li key={commit.sha}>
          <Button className="button link" onClick={() => { setPreviewCommit(commit.sha); setDirectory(""); setSelectedFile(null); setFileHistory([]); }}>{commit.subject || "(no subject)"}</Button> <code>{commit.sha.slice(0, 12)}</code>
        </li>)}</ul></section>}
        {blameLines.length > 0 && <section aria-label="File blame"><h3>Blame</h3><div style={{ overflow: "auto", maxHeight: 360, display: "grid", gap: 4 }}>{blameLines.map(line => <div key={line.line} style={{ display: "grid", gridTemplateColumns: "42px 88px minmax(100px, 180px) 1fr", gap: 8, padding: "3px 0", borderBottom: "1px solid var(--border-subtle, #ddd)" }}>
          <code>{line.line}</code><code>{line.commit_sha.slice(0, 8)}</code><span>{line.author}</span><code style={{ overflowWrap: "anywhere" }}>{line.content}</code>
        </div>)}</div></section>}
        {selectedFile.path.split("/").at(-1)?.toLowerCase() === "readme.md" ? <RepositoryReadme content={selectedFile.content}/> : <pre style={{ overflow: "auto", maxHeight: 640, padding: 16, borderRadius: 6, background: "var(--surface-subtle, #f6f8fa)", whiteSpace: "pre", tabSize: 2 }}><code>{selectedFile.content}</code></pre>}
      </div>}
    </section>}
  </section>;
}
