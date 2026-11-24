import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileCode2, Folder, Save, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Checkbox, Input, TextArea } from "../../shared/ui";
import { workspaceAPI, type OrganizationSummary, type Workspace, type WorkspaceTreeEntry, type WorkspaceFile, type WorkspaceDiffEntry } from "../../shared/api/identity";
import { APIError, translateError } from "../../shared/api/errors";
import { workspaceDiffStatusKey, workspaceSourceKey, workspaceStatusKey } from "./workspace-keys";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };

/**
 * Workspace WebIDE slice: an isolated server-side workspace pinned to a base commit, a bounded text
 * editor and optimistic overlay saves.
 *
 * It lives next to the changeset WebIDE (`WebIDEPage`) on purpose: that editor writes revisions on a
 * changeset branch, this one writes overlay files in a workspace that is materialised into an
 * immutable revision when the changes are handed off.
 */
export function WorkspaceEditorPage({ organization, onNotify }: Props) {
  const { t } = useTranslation("repositories");
  const { owner = "", repo = "" } = useParams();
  const repository = owner + "/" + repo;
  const [requiresSignoff, setRequiresSignoff] = useState(false);
  const [signoff, setSignoff] = useState(false);
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
    setSignoff(false);
  }, [organization.id]);

  const createWorkspace = async () => {
    setLoading(true); setError("");
    try {
      const result = await workspaceAPI.create(organization.id, repository);
      setWorkspace(result.workspace);
      setRequiresSignoff(Boolean(result.web_commit_signoff_required));
      setDirectory("");
      await loadTree(result.workspace.id);
      await loadDiff(result.workspace.id);
      onNotify(t("repositories:workspace.created"));
    } catch (cause) {
      setError(translateError(cause, t, "repositories:workspace.errors.createFailed"));
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
      setError(translateError(cause, t, "repositories:workspace.errors.readFailed"));
    } finally { setLoading(false); }
  };

  const createChangeset = async () => {
    if (!workspace || diffItems.length === 0 || dirty || loading || (requiresSignoff && !signoff)) return;
    setLoading(true); setError("");
    try {
      const result = await workspaceAPI.createChangeset(organization.id, workspace.id, `Update ${repository}`, requiresSignoff ? signoff : undefined);
      setSignoff(false);
      onNotify(t("repositories:workspace.changesetCreated", { id: result.changeset.changeset.id }));
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 422 && cause.title === "Web commit sign-off required") {
        setRequiresSignoff(true);
        setError(t("webide.signoffRequired"));
        return;
      }
      setError(translateError(cause, t, "repositories:workspace.errors.changesetFailed"));
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
      onNotify(t("repositories:workspace.saved"));
    } catch (cause) {
      setError(translateError(cause, t, "repositories:workspace.errors.saveFailed"));
    } finally { setLoading(false); }
  };

  const visible = tree.filter(item => item.name.toLowerCase().includes(query.toLowerCase()));
  return <section className="org-admin">
    <div className="org-admin-summary card">
      <div className="org-admin-summary__icon"><FileCode2 size={19}/></div>
      <div><h2>{t("repositories:workspace.title")}</h2><p>{t("repositories:workspace.description", { repository })}</p></div>
      <span className="org-role">{workspace ? t(`repositories:${workspaceStatusKey(workspace.status)}`) : t("repositories:workspace.status.notStarted")}</span>
      {!workspace && <Button className="button primary" disabled={loading} onClick={() => void createWorkspace()}>{t("repositories:workspace.create")}</Button>}
      <Button className="button secondary" disabled={!workspace || loading} onClick={() => setShowDiff(value => !value)}> {showDiff ? t("repositories:workspace.hideDiff") : t("repositories:workspace.showDiff")} ({diffItems.length})</Button>
      <Button className="button primary" disabled={!workspace || diffItems.length === 0 || loading || dirty || (requiresSignoff && !signoff)} onClick={() => void createChangeset()}>{t("repositories:workspace.createChangeset")}</Button>
      <Button className="button secondary" disabled={!selected || !dirty || loading} onClick={() => void save()}><Save size={14}/> {t("repositories:workspace.save")}</Button>
      <Link className="button secondary" to={`/orgs/${organization.slug}/repositories`}><ArrowLeft size={14}/> {t("repositories:workspace.backToRepositories")}</Link>
    </div>
    {workspace && <p className="changeset-hint">{t("repositories:workspace.summary", { id: workspace.id, base: workspace.base_commit_sha.slice(0, 12), expires: new Date(workspace.expires_at).toLocaleString() })}</p>}
    {requiresSignoff && !dirty && diffItems.length > 0 && <div className="changeset-hint"><Checkbox label={t("webide.signoffConsent")} checked={signoff} disabled={loading}
      onChange={event => setSignoff(event.target.checked)} />
      <a href="https://developercertificate.org/" target="_blank" rel="noreferrer">{t("webide.readDco")}</a>
    </div>}
    {error && <div className="org-error" role="alert">{error}</div>}
    {showDiff && <div className="card" style={{padding:12,marginBottom:12}}><h3>{t("repositories:workspace.changesHeading")}</h3>{diffItems.length ? <ul>{diffItems.map(item=><li key={item.path}><code>{item.path}</code> · {t(`repositories:${workspaceDiffStatusKey(item.status)}`)} · v{item.version}</li>)}</ul> : <p className="changeset-hint">{t("repositories:workspace.noChanges")}</p>}</div>}
    <div className="card" style={{display:"grid",gridTemplateColumns:"minmax(220px, 28%) minmax(0,1fr)",minHeight:520,overflow:"hidden"}}>
      <aside style={{borderRight:"1px solid var(--border, #ddd)",padding:12,minWidth:0}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}><Search size={14}/><Input aria-label={t("repositories:workspace.searchLabel")} value={query} onChange={event=>setQuery(event.target.value)} placeholder={t("repositories:workspace.filterPlaceholder")} style={{width:"100%"}}/></div>
        <div style={{marginTop:12,display:"grid",gap:4}}>
          {directory && <Button className="button link" onClick={()=>{const parent=directory.split("/").slice(0,-1).join("/");setDirectory(parent);if(workspace)void loadTree(workspace.id,parent);}}>..</Button>}
          {visible.map(item=><Button key={item.path} className="button link" onClick={()=>void openFile(item)} style={{justifyContent:"flex-start",overflowWrap:"anywhere"}}>
            {item.kind==="tree"?<Folder size={14}/>:<FileCode2 size={14}/>} {item.name}
          </Button>)}
          {!visible.length && <p className="changeset-hint">{workspace?t("repositories:workspace.emptyDirectory"):t("repositories:workspace.emptyWorkspace")}</p>}
        </div>
      </aside>
      <main style={{minWidth:0,padding:12,display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",marginBottom:8}}>
          <strong>{selected?.path ?? t("repositories:workspace.selectFile")}</strong>
          <span className="changeset-hint">{dirty?t("repositories:workspace.unsaved"):selected?t(`repositories:${workspaceSourceKey(selected.source)}`):t("repositories:workspace.readOnly")}</span>
        </div>
        <TextArea aria-label={t("repositories:workspace.editorLabel")} spellCheck={false} value={content} onChange={event=>{setContent(event.target.value);setDirty(true);}} disabled={!selected || workspace?.status!=="active"} style={{flex:1,minHeight:440,width:"100%",resize:"vertical",fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",fontSize:13,lineHeight:1.55,padding:12,border:"1px solid var(--border, #ccc)",borderRadius:8,background:"var(--surface, #fff)",color:"inherit"}}/>
      </main>
    </div>
    {loading && <p className="changeset-hint" role="status">{t("repositories:workspace.loading")}</p>}
    <p className="changeset-hint">{t("repositories:workspace.notice")}</p>
  </section>;
}
