import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Search, GitCommitHorizontal, GitBranch, Play, ShieldCheck, GitMerge, CheckCircle2, AlertTriangle, FileCheck2 } from "lucide-react";
import { changesetAPI, repositoryAPI, type RepositoryMetadata, type StoredChangeset } from "../../shared/api/identity";
import type { OrganizationSummary } from "../../shared/api/identity";

type Props = { organization: OrganizationSummary; accountUserID: string; onNotify: (message: string) => void };
const dateTime = (value: string) => new Date(value).toLocaleString();
function statusOf(item: StoredChangeset["changeset"]): string {
  if (item.merge) return "Merged";
  const revision=item.revisions[item.revisions.length-1];
  if (!revision) return "Draft";
  const evaluation=item.evaluations.filter(value=>value.revision_id===revision.id).slice(-1)[0];
  if (evaluation?.status==="failed") return "Evaluation failed";
  if (evaluation?.status!=="passed") return "Evaluation pending";
  if (!item.evidence.some(value=>value.revision_id===revision.id&&value.status==="active")) return "Evidence required";
  const review=item.reviews.filter(value=>value.revision_id===revision.id).slice(-1)[0];
  if (!review) return "Review required";
  if (review.status==="rejected") return "Changes requested";
  if (review.status!=="approved") return "In review";
  return "Ready to merge";
}
function statusClass(status: string) {
  if (status==="Merged"||status==="Ready to merge") return "status success";
  if (status==="Evaluation failed"||status==="Changes requested") return "status danger";
  return "status muted";
}

export function ChangesetsPage({ organization, accountUserID, onNotify }: Props) {
  const [items,setItems]=useState<StoredChangeset[]>([]);
  const [repositories,setRepositories]=useState<RepositoryMetadata[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [repository,setRepository]=useState("");
  const [title,setTitle]=useState("");
  const [repoSlug,setRepoSlug]=useState("");
  const [defaultBranch,setDefaultBranch]=useState("main");
  const [search,setSearch]=useState("");
  const [selectedID,setSelectedID]=useState("");
  const [revisionRef,setRevisionRef]=useState("");
  const [reviewerID,setReviewerID]=useState("");
  const [reviewComment,setReviewComment]=useState("");
  const [targetRef,setTargetRef]=useState("main");
  const [decisionComment,setDecisionComment]=useState("");
  const canManageRepositories=organization.role==="owner"||organization.role==="admin";
  const selected=items.find(item=>item.changeset.id===selectedID);

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const [page,repoPage]=await Promise.all([changesetAPI.list(organization.id),repositoryAPI.list(organization.id)]);
      setItems(page.items);setRepositories(repoPage.items);
      if(!repository&&repoPage.items.length)setRepository(repoPage.items[0].slug);
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to load delivery data");}
    finally{setLoading(false);}
  },[organization.id]);
  useEffect(()=>{void load();},[load]);

  const run=async(action:()=>Promise<StoredChangeset>,message:string)=>{
    setBusy(true);setError("");
    try{const updated=await action();setItems(current=>{const next=current.filter(value=>value.changeset.id!==updated.changeset.id);return [updated,...next]});setSelectedID(updated.changeset.id);onNotify(message);}
    catch(cause){setError(cause instanceof Error?cause.message:"Delivery operation failed");}
    finally{setBusy(false);}
  };
  const create=async(event:FormEvent)=>{
    event.preventDefault();await run(()=>changesetAPI.create(organization.id,repository,title.trim()),"Changeset created and persisted.");setTitle("");
  };
  const register=async(event:FormEvent)=>{
    event.preventDefault();setBusy(true);setError("");
    try{const added=await repositoryAPI.register(organization.id,repoSlug.trim(),defaultBranch.trim());setRepositories(current=>[...current,added]);setRepository(added.slug);setRepoSlug("");onNotify("Repository registered.");}
    catch(cause){setError(cause instanceof Error?cause.message:"Repository registration failed");}
    finally{setBusy(false);}
  };
  const filtered=useMemo(()=>items.filter(({changeset})=>{const needle=search.trim().toLowerCase();return !needle||[changeset.id,changeset.title,changeset.repository,changeset.created_by].some(value=>value.toLowerCase().includes(needle));}),[items,search]);
  const currentRevision=selected?.changeset.revisions.slice(-1)[0];
  const currentEvaluation=currentRevision&&selected?.changeset.evaluations.filter(value=>value.revision_id===currentRevision.id).slice(-1)[0];
  const currentReview=currentRevision&&selected?.changeset.reviews.filter(value=>value.revision_id===currentRevision.id).slice(-1)[0];
  const activeEvidence=!!(currentRevision&&selected?.changeset.evidence.some(value=>value.revision_id===currentRevision.id&&value.status==="active"));
  const canMerge=!!(currentRevision&&currentEvaluation?.status==="passed"&&activeEvidence&&currentReview?.status==="approved"&&!selected?.changeset.merge);

  return <section className="changesets-page">
    <div className="changesets-summary card"><div className="changesets-summary__icon"><GitCommitHorizontal size={20}/></div><div><b>{items.length} persisted changesets</b><p>Organization-scoped Git lifecycle · PostgreSQL state</p></div><span className="org-role">{organization.role}</span><button className="button secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Refresh</button></div>
    {error&&<div className="org-error" role="alert">{error}</div>}
    {canManageRepositories&&<form className="changeset-create card" onSubmit={register}><div className="changeset-create__heading"><div><h3>Register repository</h3><p>Repository must already exist under the server's trusted Git root</p></div><span className="changeset-create__secure">Owner / Admin</span></div><div className="changeset-create__fields"><label>Repository slug<input required pattern="[^/]+/[^/]+" value={repoSlug} onChange={event=>setRepoSlug(event.target.value)} placeholder="team/repository"/></label><label>Default branch<input required value={defaultBranch} onChange={event=>setDefaultBranch(event.target.value)} placeholder="main"/></label><button className="button secondary" type="submit" disabled={busy}><Plus size={14}/> Register</button></div></form>}
    {repositories.length>0&&<form className="changeset-create card" onSubmit={create}><div className="changeset-create__heading"><div><h3>Create changeset</h3><p>Starts a persisted delivery workflow against a registered repository</p></div><span className="changeset-create__secure">Server validated</span></div><div className="changeset-create__fields"><label>Repository<select required value={repository} onChange={event=>setRepository(event.target.value)}>{repositories.map(item=><option key={item.slug} value={item.slug}>{item.slug} · {item.default_branch}</option>)}</select></label><label>Title<input required maxLength={200} value={title} onChange={event=>setTitle(event.target.value)} placeholder="Describe the change"/></label><button className="button primary" type="submit" disabled={busy||!repository}><Plus size={14}/> Create</button></div></form>}
    {!repositories.length&&!loading&&<div className="org-admin-empty card"><GitBranch size={22}/><h2>No repositories registered</h2><p>{canManageRepositories?"Register an existing repository above. The API resolves its default branch against the configured local Git provider.":"Ask an organization owner or administrator to register a repository."}</p></div>}
    <div className="changesets-list card"><div className="changesets-list__head"><div><h3>Changesets</h3><p>Newest records first · scoped to {organization.name}</p></div><label className="changesets-search"><Search size={14}/><input aria-label="Search changesets" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search ID, title or repository"/></label></div>
      {loading?<div className="org-loading">Loading changesets…</div>:<div className="org-table-wrap changesets-table-wrap"><table className="org-table changesets-table"><thead><tr><th>CHANGESET</th><th>REPOSITORY</th><th>STATUS</th><th>REVISION</th><th>UPDATED</th><th>VERSION</th></tr></thead><tbody>{filtered.map(item=>{const change=item.changeset;const status=statusOf(change);return <tr key={change.id} className={selectedID===change.id?"is-selected":""} onClick={()=>setSelectedID(selectedID===change.id?"":change.id)}><td><b>{change.title}</b><small className="mono">{change.id}</small></td><td>{change.repository}</td><td><span className={statusClass(status)}>{status}</span></td><td>{change.revisions.slice(-1)[0]?.commit_sha?.slice(0,12)||"—"}</td><td>{dateTime(item.updated_at)}</td><td><span className="mono">v{item.version}</span></td></tr>})}{!filtered.length&&<tr><td colSpan={6} className="org-empty">{items.length?"No changesets match this search.":"No changesets yet."}</td></tr>}</tbody></table></div>}
      <div className="changesets-list__foot"><span>{filtered.length} of {items.length} changesets</span><span><AlertTriangle size={12}/> Data from organization API</span></div>
    </div>
    {selected&&<div className="changeset-detail card"><div className="changeset-detail__head"><div><h3>{selected.changeset.title}</h3><p>{selected.changeset.repository} · Created by {selected.changeset.created_by}</p></div><span className={statusClass(statusOf(selected.changeset))}>{statusOf(selected.changeset)}</span></div>
      <div className="changeset-steps">{["Repository","Revision","Evaluation","Evidence","Review","Merge"].map((step,index)=><div key={step} className={["is-complete",currentRevision&&index>0?"is-complete":"",currentEvaluation?.status==="passed"&&index>1?"is-complete":"",activeEvidence&&index>2?"is-complete":"",currentReview?.status==="approved"&&index>3?"is-complete":"",selected.changeset.merge&&index>4?"is-complete":""].join(" ")}><span>{index+1}</span><b>{step}</b></div>)}</div>
      <div className="changeset-workflow">
        <form onSubmit={event=>{event.preventDefault();void run(()=>changesetAPI.addRevision(organization.id,selected.changeset.id,revisionRef),"Git revision resolved and persisted.");setRevisionRef("");}}><label><GitBranch size={14}/> Resolve Git ref<input required value={revisionRef} onChange={event=>setRevisionRef(event.target.value)} placeholder="branch, tag or commit SHA"/></label><button className="button secondary" disabled={busy||!!selected.changeset.merge}>Add revision</button></form>
        <div><label><Play size={14}/> Trusted evaluation</label><p>{currentEvaluation?currentEvaluation.summary:"No evaluation for the current revision."}</p><button className="button secondary" disabled={busy||!currentRevision||!!selected.changeset.merge} onClick={()=>void run(()=>changesetAPI.evaluate(organization.id,selected.changeset.id),"Trusted evaluation completed.")}>Run evaluation</button></div>
        <div><label><FileCheck2 size={14}/> Evidence provenance</label><p>{activeEvidence?selected.changeset.evidence.filter(value=>value.revision_id===currentRevision?.id&&value.status==="active").map(value=>value.sha256||value.uri).join(", "):"Evidence is generated automatically from a passing evaluation report."}</p><span className="org-role">{activeEvidence?"Verified artifact":"Awaiting passing evaluation"}</span></div>
        <form onSubmit={event=>{event.preventDefault();void run(()=>changesetAPI.assignReview(organization.id,selected.changeset.id,reviewerID,reviewComment),"Review assigned to an active organization member.");setReviewerID("");setReviewComment("");}}><label><ShieldCheck size={14}/> Assign review (active member ID)<input required value={reviewerID} onChange={event=>setReviewerID(event.target.value)} placeholder="reviewer user ID"/><input value={reviewComment} onChange={event=>setReviewComment(event.target.value)} placeholder="Review context (optional)"/></label><button className="button secondary" disabled={busy||!activeEvidence||!!selected.changeset.merge}>Assign review</button></form>
        {currentReview&&<div><label><ShieldCheck size={14}/> Review decision</label><p>Assigned to {currentReview.reviewer} · {currentReview.status}{currentReview.comment?" · "+currentReview.comment:""}</p>{currentReview.reviewer===accountUserID&&currentReview.status==="pending"&&<div className="org-actions"><button className="button secondary" disabled={busy} onClick={()=>void run(()=>changesetAPI.decideReview(organization.id,selected.changeset.id,currentReview.id,true,decisionComment),"Review approved.")}>Approve</button><button className="button secondary" disabled={busy} onClick={()=>void run(()=>changesetAPI.decideReview(organization.id,selected.changeset.id,currentReview.id,false,decisionComment),"Changes requested.")}>Request changes</button></div>}<input value={decisionComment} onChange={event=>setDecisionComment(event.target.value)} placeholder="Decision comment"/></div>}
        <form onSubmit={event=>{event.preventDefault();void run(()=>changesetAPI.merge(organization.id,selected.changeset.id,targetRef),"Git merge completed and persisted.");}}><label><GitMerge size={14}/> Merge target<input required value={targetRef} onChange={event=>setTargetRef(event.target.value)} placeholder="main"/></label><button className="button primary" disabled={busy||!canMerge}>Merge changeset</button></form>
      </div>
      {selected.changeset.merge&&<div className="changeset-merge-result"><CheckCircle2 size={15}/> Merged as <code>{selected.changeset.merge.commit_sha}</code> into {selected.changeset.merge.target_ref}</div>}
      {selected.changeset.audit.length>0&&<div className="changeset-audit"><h4>Lifecycle audit</h4>{selected.changeset.audit.slice().reverse().map(event=><div key={event.sequence}><span>{event.operation}</span><small>{event.actor} · {dateTime(event.at)}</small></div>)}</div>}
    </div>}
  </section>;
}
