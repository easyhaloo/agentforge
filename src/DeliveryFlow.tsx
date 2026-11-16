import { useMemo, useState } from "react";
import { Activity, ArrowDown, ArrowRight, Check, CheckCircle2, CircleAlert, GitBranch, GitCommitHorizontal, GitPullRequest, Play, Plus, RefreshCw, ShieldCheck, Sparkles, Workflow } from "lucide-react";

type Evaluation = { id: string; revision: number; status: "Passed" | "Failed"; checks: number; createdAt: string };
type Review = { id: string; revision: number; decision: "Pending" | "Approved" | "Changes requested"; reviewer: string };
type Change = { id: string; title: string; revision: number; base: string; status: "Draft" | "Evaluating" | "Ready for review" | "Changes requested" | "Approved" | "Merged"; files: number; };
const initialChange: Change = { id:"CS-2481", title:"Refactor auth token lifecycle", revision:3, base:"main", status:"Draft", files:12 };
const initialEvaluations: Evaluation[] = [{id:"EVL-5509",revision:3,status:"Passed",checks:38,createdAt:"Today, 10:42"}];
const initialReviews: Review[] = [{id:"REV-891",revision:3,decision:"Pending",reviewer:"Mina"}];

const stages = [
  {id:"Changesets",label:"Changeset",desc:"Revisioned change"},
  {id:"Eval",label:"Eval",desc:"Verification evidence"},
  {id:"Review",label:"Review",desc:"Human decision"},
  {id:"Trails",label:"Trail",desc:"Delivery outcome"}
];

export function DeliveryFlow({page,onNotify}:{page:string;onNotify:(message:string)=>void}) {
  const [change,setChange]=useState<Change>(initialChange);
  const [evaluations,setEvaluations]=useState<Evaluation[]>(initialEvaluations);
  const [reviews,setReviews]=useState<Review[]>(initialReviews);
  const [trailDone,setTrailDone]=useState(false);
  const [stackBase,setStackBase]=useState("main");
  const [repairCount,setRepairCount]=useState(0);
  const [title,setTitle]=useState(initialChange.title);
  const [events,setEvents]=useState<string[]>(["CS-2481 r3 created from main","EVL-5509 passed 38 checks"]);
  const latestEval=evaluations[0];
  const latestReview=reviews[0];
  const evidenceCurrent=latestEval?.revision===change.revision;
  const approved=latestReview?.revision===change.revision&&latestReview.decision==="Approved";
  const stageState=useMemo(()=>[
    change.status==="Draft"?"In progress":change.status,
    evidenceCurrent?(latestEval.status==="Passed"?"Passed":"Failed"):"Stale",
    latestReview?.revision===change.revision?latestReview.decision:"Not reviewed",
    trailDone?"Completed":"In progress"
  ],[change,latestEval,evidenceCurrent,latestReview,trailDone]);
  const record=(message:string)=>{setEvents(prev=>[message,...prev].slice(0,8));onNotify(message);};
  const createRevision=()=>{const next=change.revision+1;setChange({...change,revision:next,status:"Draft"});setReviews([{id:"REV-"+(891+next),revision:next,decision:"Pending",reviewer:"Mina"},...reviews]);record(`Created ${change.id} r${next}; previous evidence is now stale`);};
  const runEval=()=>{const passed=repairCount<1||change.revision>3;const evaluation:Evaluation={id:"EVL-"+(5510+evaluations.length),revision:change.revision,status:passed?"Passed":"Failed",checks:38,createdAt:"Just now"};setEvaluations([evaluation,...evaluations]);setChange({...change,status:passed?"Ready for review":"Evaluating"});record(`${evaluation.id} ${passed?"passed":"failed"} on ${change.id} r${change.revision}`);};
  const decide=(decision:"Approved"|"Changes requested")=>{if(!evidenceCurrent||latestEval.status!=="Passed"){record("Review blocked: current passing evidence is required");return;}const review:Review={id:"REV-"+(892+reviews.length),revision:change.revision,decision,reviewer:"You"};setReviews([review,...reviews]);setChange({...change,status:decision==="Approved"?"Approved":"Changes requested"});record(`${decision} ${change.id} r${change.revision}`);};
  const merge=()=>{if(!approved){record("Merge blocked: approval for the current revision is required");return;}setChange({...change,status:"Merged"});setTrailDone(true);record(`${change.id} r${change.revision} merged; Trail TRL-042 completed`);};
  const repair=()=>{setRepairCount(repairCount+1);createRevision();record("Self-healing prepared a new revision; run Eval again");};
  const restack=()=>{setStackBase("main@"+(Date.now()%10000));record("Stack restacked against the latest base (demo)");};
  const stageIndex=Math.max(0,stages.findIndex(s=>s.id===page));
  return <div className="delivery-flow">
    <div className="flow-banner"><div className="flow-banner-icon"><Workflow size={19}/></div><div><b>Verified delivery workflow</b><p>One revision is traced through evaluation, human review and delivery. Evidence is always revision-scoped.</p></div><span className="demo-pill">INTERACTIVE DEMO</span></div>
    <div className="flow-stage-track">{stages.map((stage,i)=><div className={`flow-stage ${i===stageIndex?"focused":""} ${i<stageIndex?"visited":""}`} key={stage.id}><div className="flow-stage-top"><span>{i+1}</span><b>{stage.label}</b><small>{stageState[i]}</small></div><p>{stage.desc}</p>{i<stages.length-1&&<ArrowRight size={14}/>}</div>)}</div>
    <div className="flow-main-grid">
      <section className="card flow-primary">
        <div className="flow-section-head"><div><span className="eyebrow">ACTIVE CHANGESET</span><h3>{change.id} <span className="revision-chip">r{change.revision}</span></h3><p>Changeset ID is stable across revisions; Git commit SHAs are separate objects.</p></div><span className={`resource-status ${change.status==="Merged"?"flow-good":""}`}>{change.status}</span></div>
        <label className="flow-label">Change title<input value={title} onChange={e=>setTitle(e.target.value)} onBlur={()=>setChange({...change,title})}/></label>
        <div className="flow-facts"><div><span>Base branch</span><b>{change.base}</b></div><div><span>Changed files</span><b>{change.files}</b></div><div><span>Stack base</span><b>{stackBase}</b></div></div>
        <div className="flow-actions">
          <button className="button secondary compact" onClick={createRevision}><Plus size={14}/> New revision</button>
          <button className="button primary compact" onClick={runEval}><Play size={14}/> Run Eval</button>
          <button className="button secondary compact" onClick={repair}><Sparkles size={14}/> Self-heal</button>
          <button className="button secondary compact" onClick={restack}><RefreshCw size={14}/> Restack</button>
        </div>
        <div className="flow-subsection"><div className="flow-subhead"><h4><ShieldCheck size={14}/> Evaluation evidence</h4><span>{evidenceCurrent?"Current":"Stale"}</span></div>{evaluations.slice(0,3).map(e=><div className="evidence-row" key={e.id}><span className={e.status==="Passed"?"evidence-icon pass":"evidence-icon fail"}>{e.status==="Passed"?<Check size={13}/>:<CircleAlert size={13}/>}</span><div><b>{e.id} · r{e.revision}</b><small>{e.checks} checks · {e.createdAt}</small></div><strong>{e.status}</strong></div>)}</div>
        <div className="flow-subsection"><div className="flow-subhead"><h4><GitPullRequest size={14}/> Review decision</h4><span>{latestReview?.decision??"Not requested"}</span></div>{reviews.slice(0,3).map(r=><div className="evidence-row" key={r.id}><span className="evidence-icon review"><GitPullRequest size={13}/></span><div><b>{r.id} · r{r.revision}</b><small>{r.reviewer} · revision-scoped review</small></div><strong>{r.decision}</strong></div>)}<div className="flow-actions review-actions"><button className="button secondary compact" disabled={!evidenceCurrent||latestEval.status!=="Passed"} onClick={()=>decide("Changes requested")}>Request changes</button><button className="button primary compact" disabled={!evidenceCurrent||latestEval.status!=="Passed"} onClick={()=>decide("Approved")}><CheckCircle2 size={14}/> Approve revision</button></div></div>
        <div className="flow-subsection"><div className="flow-subhead"><h4><GitBranch size={14}/> Stack & Trail</h4><span>{trailDone?"Delivered":"In progress"}</span></div><div className="trail-summary"><div><b>STK-018 · Auth service rollout</b><small>3 changesets · base {stackBase}</small></div><div><b>TRL-042 · Migrate authentication API</b><small>{trailDone?"6/6 changesets completed":"4/6 changesets · waiting on this changeset"}</small></div><button className="button primary compact" disabled={!approved} onClick={merge}><GitCommitHorizontal size={14}/> Merge & complete Trail</button></div></div>
      </section>
      <aside className="card flow-aside"><div className="flow-section-head"><div><span className="eyebrow">AUDIT TRAIL</span><h3>Workflow events</h3><p>Ordered activity for this demo changeset.</p></div><Activity size={16}/></div><div className="event-timeline">{events.map((event,i)=><div className="timeline-event" key={event+i}><span className="timeline-dot"/><div><b>{event}</b><small>{i===0?"Just now":`${i*4} min ago`}</small></div></div>)}</div><div className="flow-invariant"><ShieldCheck size={15}/><div><b>Merge gate</b><p>Merge requires a passing evaluation for the exact current revision and an approval for that same revision.</p></div></div><div className="flow-invariant"><GitCommitHorizontal size={15}/><div><b>Evidence invalidation</b><p>Creating a new revision makes prior evaluation evidence and review decisions stale.</p></div></div><div className="prototype-callout"><Sparkles size={14}/>All records are local demo state. No Git commit, remote CI, reviewer notification or merge operation is performed.</div></aside>
    </div>
    <div className="flow-bottom-note"><CheckCircle2 size={14}/> Try the sequence: New revision → Run Eval → Approve revision → Merge & complete Trail. Then create another revision to see evidence become stale.</div>
  </div>;
}
