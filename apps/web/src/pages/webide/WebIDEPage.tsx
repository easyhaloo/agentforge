import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileCode2, Folder, Save, Search } from "lucide-react";
import { Button, Input, TextArea } from "../../shared/ui";
import { workspaceAPI, type OrganizationSummary, type Workspace, type WorkspaceTreeEntry, type WorkspaceFile, type WorkspaceDiffEntry } from "../../shared/api/identity";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };

/** First WebIDE slice: isolated server workspace, bounded text editor and optimistic saves. */
export function WebIDEPage({ organization, onNotify }: Props) {
  const { owner = "", repo = "" } = useParams();
  const repository = owner + "/" + repo;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tree, setTree] = useState<WorkspaceTreeEntry[]>([]);
  const [directory, setDirectory] = useState("");
  const [selected, setSelected] = useState<WorkspaceFile | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [diffItems, setDiffItems] = useState<WorkspaceDiffEntry[]>([]);
  const [showDiff, setShowDiff] = useState(false);

  const loadTree = useCallback(async (id: string, path = "") => {
    const result = await workspaceAPI.tree(organization.id, id, path);
    setTree(result.items);
  }, [organization.id]);

  const loadDiff = useCallback(async (id: string) => {
    const result = await workspaceAPI.diff(organization.id, id);
    setDiffItems(result.items);
  }, [organization.id]);

  const createWorkspace = async () => {
    setLoading(true); setError("");
    try {
      const result = await workspaceAPI.create(organization.id, repository);
      setWorkspace(result.workspace);
      setDirectory("");
      await loadTree(result.workspace.id);
      await loadDiff(result.workspace.id);
      onNotify("Isolated workspace created.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create workspace");
    } finally { setLoading(false); }
  };

  const openFile = async (entry: WorkspaceTreeEntry) => {
    if (entry.kind === "tree") {
      setDirectory(entry.path);
      if (workspace) await loadTree(workspace.id, entry.path);
      return;
    }
    if (!workspace) return;
    setLoading(true); setError("");
    try {
      const file = await workspaceAPI.readFile(organization.id, workspace.id, entry.path);
      setSelected(file); setContent(file.content); setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to read file");
    } finally { setLoading(false); }
  };

  const save = async () => {
    if (!workspace || !selected || !dirty) return;
    setLoading(true); setError("");
    try {
      const saved = await workspaceAPI.writeFile(organization.id, workspace.id, selected.path, content, selected.version);
      setSelected(saved); setDirty(false);
      await loadTree(workspace.id, directory);
      await loadDiff(workspace.id);
      onNotify("Workspace file saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed. Reload the file before retrying.");
    } finally { setLoading(false); }
  };

  const visible = tree.filter(item => item.name.toLowerCase().includes(query.toLowerCase()));
  return <section className="org-admin">
    <div className="org-admin-summary card">
      <div className="org-admin-summary__icon"><FileCode2 size={19}/></div>
      <div><h2>WebIDE</h2><p>{repository} · isolated workspace editor</p></div>
      <span className="org-role">{workspace?.status ?? "not started"}</span>
      {!workspace && <Button className="button primary" disabled={loading} onClick={() => void createWorkspace()}>Create workspace</Button>}
      <Button className="button secondary" disabled={!workspace || loading} onClick={() => setShowDiff(value => !value)}> {showDiff ? "Hide diff" : "Workspace diff"} ({diffItems.length})</Button>
      <Button className="button secondary" disabled={!selected || !dirty || loading} onClick={() => void save()}><Save size={14}/> Save</Button>
      <Link className="button secondary" to={`/orgs/${organization.slug}/repositories`}><ArrowLeft size={14}/> Repositories</Link>
    </div>
    {workspace && <p className="changeset-hint">Workspace <code>{workspace.id}</code> · base <code>{workspace.base_commit_sha.slice(0, 12)}</code> · expires {new Date(workspace.expires_at).toLocaleString()}</p>}
    {error && <div className="org-error" role="alert">{error}</div>}
    {showDiff && <div className="card" style={{padding:12,marginBottom:12}}><h3>Workspace changes</h3>{diffItems.length ? <ul>{diffItems.map(item=><li key={item.path}><code>{item.path}</code> · {item.status} · v{item.version}</li>)}</ul> : <p className="changeset-hint">No saved workspace changes.</p>}</div>}
    <div className="card" style={{display:"grid",gridTemplateColumns:"minmax(220px, 28%) minmax(0,1fr)",minHeight:520,overflow:"hidden"}}>
      <aside style={{borderRight:"1px solid var(--border, #ddd)",padding:12,minWidth:0}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}><Search size={14}/><Input aria-label="Search files" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Filter files" style={{width:"100%"}}/></div>
        <div style={{marginTop:12,display:"grid",gap:4}}>
          {directory && <Button className="button link" onClick={()=>{const parent=directory.split("/").slice(0,-1).join("/");setDirectory(parent);if(workspace)void loadTree(workspace.id,parent);}}>..</Button>}
          {visible.map(item=><Button key={item.path} className="button link" onClick={()=>void openFile(item)} style={{justifyContent:"flex-start",overflowWrap:"anywhere"}}>
            {item.kind==="tree"?<Folder size={14}/>:<FileCode2 size={14}/>} {item.name}
          </Button>)}
          {!visible.length && <p className="changeset-hint">{workspace?"No files in this directory.":"Create a workspace to browse files."}</p>}
        </div>
      </aside>
      <main style={{minWidth:0,padding:12,display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",marginBottom:8}}>
          <strong>{selected?.path ?? "Select a file"}</strong>
          <span className="changeset-hint">{dirty?"Unsaved changes":selected?selected.source:"Read-only until a file is selected"}</span>
        </div>
        <TextArea aria-label="Source editor" spellCheck={false} value={content} onChange={event=>{setContent(event.target.value);setDirty(true);}} disabled={!selected || workspace?.status!=="active"} style={{flex:1,minHeight:440,width:"100%",resize:"vertical",fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",fontSize:13,lineHeight:1.55,padding:12,border:"1px solid var(--border, #ccc)",borderRadius:8,background:"var(--surface, #fff)",color:"inherit"}}/>
      </main>
    </div>
    {loading && <p className="changeset-hint" role="status">Loading workspace…</p>}
    <p className="changeset-hint">MVP editor uses a bounded plain-text surface. Terminal, build, test and preview execution are intentionally unavailable until isolated workers are implemented.</p>
  </section>;
}
