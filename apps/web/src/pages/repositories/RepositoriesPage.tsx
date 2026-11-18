import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ChevronLeft, Code2, FileText, Folder, Plus, RefreshCw, X } from "lucide-react";
import {
  repositoryAPI,
  repositoryPreviewAPI,
  type OrganizationSummary,
  type RepositoryMetadata,
  type RepositoryPreviewBlob,
  type RepositoryPreviewEntry,
  type RepositoryPreviewTree,
} from "../../shared/api/identity";
import { Button, DataTable, Input } from "../../shared/ui";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };

/** Registered repositories and a zero-clone, read-only source browser. */
export function RepositoriesPage({ organization, onNotify }: Props) {
  const [items, setItems] = useState<RepositoryMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [slug, setSlug] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [selectedRepository, setSelectedRepository] = useState("");
  const [directory, setDirectory] = useState("");
  const [tree, setTree] = useState<RepositoryPreviewTree | null>(null);
  const [selectedFile, setSelectedFile] = useState<RepositoryPreviewBlob | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const canRegister = organization.role === "owner" || organization.role === "admin";

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
      setTree(await repositoryPreviewAPI.tree(organization.id, selectedRepository, directory));
    } catch (cause) {
      setTree(null);
      setPreviewError(cause instanceof Error ? cause.message : "Unable to load repository tree");
    } finally { setPreviewLoading(false); }
  }, [organization.id, selectedRepository, directory]);
  useEffect(() => { void loadTree(); }, [loadTree]);

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
    setPreviewLoading(true); setPreviewError(""); setSelectedFile(null);
    try {
      setSelectedFile(await repositoryPreviewAPI.blob(organization.id, selectedRepository, entry.path));
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
        { key: "slug", title: "REPOSITORY", render: (_value, item) => <Button className="button link" onClick={() => { setSelectedRepository(item.slug); setDirectory(""); setSelectedFile(null); }}><Code2 size={14}/>{item.slug}</Button> },
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
        <Button className="button secondary" onClick={() => { setSelectedRepository(""); setTree(null); setSelectedFile(null); }}><X size={14}/> Close</Button>
      </header>
      {tree && <p className="changeset-hint">Pinned commit: <code>{tree.commit_sha}</code></p>}
      {previewError && <div className="org-error" role="alert">{previewError}</div>}
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
        <pre style={{ overflow: "auto", maxHeight: 640, padding: 16, borderRadius: 6, background: "var(--surface-subtle, #f6f8fa)", whiteSpace: "pre", tabSize: 2 }}><code>{selectedFile.content}</code></pre>
      </div>}
    </section>}
  </section>;
}
