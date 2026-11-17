import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Search, GitCommitHorizontal, GitBranch, Play, ShieldCheck, GitMerge, CheckCircle2, AlertTriangle, FileCheck2 } from "lucide-react";
import { changesetAPI, repositoryAPI, type RepositoryMetadata, type StoredChangeset } from "../../shared/api/identity";
import type { OrganizationSummary } from "../../shared/api/identity";
import { Button, DataTable, Input, SearchInput, Select } from "../../shared/ui";

type Props = { organization: OrganizationSummary; accountUserID: string; onNotify: (message: string) => void };
type ChangesetRow = { id: string; title: string; repository: string; status: string; revision: string; updated: string; version: string };
const dateTime = (value: string) => new Date(value).toLocaleString();
function statusOf(item: StoredChangeset["changeset"]): string {
  if (item.merge) return "Merged";
  const revision = item.revisions[item.revisions.length - 1];
  if (!revision) return "Draft";
  const evaluation = item.evaluations.filter(value => value.revision_id === revision.id).slice(-1)[0];
  if (evaluation?.status === "failed") return "Evaluation failed";
  if (evaluation?.status !== "passed") return "Evaluation pending";
  if (!item.evidence.some(value => value.revision_id === revision.id && value.status === "active")) return "Evidence required";
  const review = item.reviews.filter(value => value.revision_id === revision.id).slice(-1)[0];
  if (!review) return "Review required";
  if (review.status === "rejected") return "Changes requested";
  if (review.status !== "approved") return "In review";
  return "Ready to merge";
}
function statusClass(status: string) {
  if (status === "Merged" || status === "Ready to merge") return "status success";
  if (status === "Evaluation failed" || status === "Changes requested") return "status danger";
  return "status muted";
}

export function ChangesetsPage({ organization, accountUserID, onNotify }: Props) {
  const [items, setItems] = useState<StoredChangeset[]>([]);
  const [repositories, setRepositories] = useState<RepositoryMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [repository, setRepository] = useState("");
  const [title, setTitle] = useState("");
  const [repoSlug, setRepoSlug] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [search, setSearch] = useState("");
  const [selectedID, setSelectedID] = useState("");
  const [revisionRef, setRevisionRef] = useState("");
  const [reviewerID, setReviewerID] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [targetRef, setTargetRef] = useState("main");
  const [decisionComment, setDecisionComment] = useState("");
  const canManageRepositories = organization.role === "owner" || organization.role === "admin";
  const selected = items.find(item => item.changeset.id === selectedID);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [page, repoPage] = await Promise.all([changesetAPI.list(organization.id), repositoryAPI.list(organization.id)]);
      setItems(page.items); setRepositories(repoPage.items);
      setRepository(current => current || repoPage.items[0]?.slug || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load delivery data"); }
    finally { setLoading(false); }
  }, [organization.id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<StoredChangeset>, message: string) => {
    setBusy(true); setError("");
    try {
      const updated = await action();
      setItems(current => [updated, ...current.filter(value => value.changeset.id !== updated.changeset.id)]);
      setSelectedID(updated.changeset.id); onNotify(message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Delivery operation failed"); }
    finally { setBusy(false); }
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    await run(() => changesetAPI.create(organization.id, repository, title.trim()), "Changeset created and persisted.");
    setTitle("");
  };
  const register = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const added = await repositoryAPI.register(organization.id, repoSlug.trim(), defaultBranch.trim());
      setRepositories(current => [...current, added]); setRepository(added.slug); setRepoSlug("");
      onNotify("Repository registered.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Repository registration failed"); }
    finally { setBusy(false); }
  };
  const filtered = useMemo(() => items.filter(({ changeset }) => {
    const needle = search.trim().toLowerCase();
    return !needle || [changeset.id, changeset.title, changeset.repository, changeset.created_by].some(value => value.toLowerCase().includes(needle));
  }), [items, search]);
  const rows: ChangesetRow[] = filtered.map(({ changeset, updated_at, version }) => ({
    id: changeset.id, title: changeset.title, repository: changeset.repository, status: statusOf(changeset),
    revision: changeset.revisions.slice(-1)[0]?.commit_sha?.slice(0, 12) || "—",
    updated: dateTime(updated_at), version: `v${version}`,
  }));
  const currentRevision = selected?.changeset.revisions.slice(-1)[0];
  const currentEvaluation = currentRevision && selected?.changeset.evaluations.filter(value => value.revision_id === currentRevision.id).slice(-1)[0];
  const currentReview = currentRevision && selected?.changeset.reviews.filter(value => value.revision_id === currentRevision.id).slice(-1)[0];
  const activeEvidence = !!(currentRevision && selected?.changeset.evidence.some(value => value.revision_id === currentRevision.id && value.status === "active"));
  const canMerge = !!(currentRevision && currentEvaluation?.status === "passed" && activeEvidence && currentReview?.status === "approved" && !selected?.changeset.merge);

  return <section className="changesets-page">
    <div className="changesets-summary card">
      <div className="changesets-summary__icon"><GitCommitHorizontal size={20}/></div>
      <div><b>{items.length} persisted changesets</b><p>Organization-scoped Git lifecycle · PostgreSQL state</p></div>
      <span className="org-role">{organization.role}</span>
      <Button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/> Refresh</Button>
    </div>
    {error && <div className="org-error" role="alert">{error}</div>}
    {canManageRepositories && <form className="changeset-create card" onSubmit={register}>
      <div className="changeset-create__heading"><div><h3>Register repository</h3><p>Repository must already exist under the server's trusted Git root</p></div><span className="changeset-create__secure">Owner / Admin</span></div>
      <div className="changeset-create__fields">
        <Input label="Repository slug" required pattern="[^/]+/[^/]+" value={repoSlug} onChange={event => setRepoSlug(event.target.value)} placeholder="team/repository"/>
        <Input label="Default branch" required value={defaultBranch} onChange={event => setDefaultBranch(event.target.value)} placeholder="main"/>
        <Button className="button secondary" type="submit" disabled={busy}><Plus size={14}/> Register</Button>
      </div>
    </form>}
    {repositories.length > 0 && <form className="changeset-create card" onSubmit={create}>
      <div className="changeset-create__heading"><div><h3>Create changeset</h3><p>Starts a persisted delivery workflow against a registered repository</p></div><span className="changeset-create__secure">Server validated</span></div>
      <div className="changeset-create__fields">
        <Select label="Repository" required value={repository} onChange={event => setRepository(event.target.value)} options={repositories.map(item => ({ value: item.slug, label: `${item.slug} · ${item.default_branch}` }))}/>
        <Input label="Title" required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="Describe the change"/>
        <Button className="button primary" type="submit" disabled={busy || !repository}><Plus size={14}/> Create</Button>
      </div>
    </form>}
    {!repositories.length && !loading && <div className="org-admin-empty card"><GitBranch size={22}/><h2>No repositories registered</h2><p>{canManageRepositories ? "Register an existing repository above. The API resolves its default branch against the configured local Git provider." : "Ask an organization owner or administrator to register a repository."}</p></div>}
    <div className="changesets-list card">
      <div className="changesets-list__head">
        <div><h3>Changesets</h3><p>Newest records first · scoped to {organization.name}</p></div>
        <SearchInput value={search} onChange={setSearch} onSearch={setSearch} placeholder="Search ID, title or repository" className="changesets-search"/>
      </div>
      {loading ? <div className="org-loading">Loading changesets…</div> : <DataTable<ChangesetRow>
        columns={[
          { key: "title", title: "CHANGESET", render: (_value, row) => <div><b>{row.title}</b><small className="mono">{row.id}</small></div> },
          { key: "repository", title: "REPOSITORY" },
          { key: "status", title: "STATUS", render: value => <span className={statusClass(String(value))}>{String(value)}</span> },
          { key: "revision", title: "REVISION" },
          { key: "updated", title: "UPDATED" },
          { key: "version", title: "VERSION" },
        ]}
        data={rows} rowKey="id" showColumnVisibility={false} emptyText={items.length ? "No changesets match this search." : "No changesets yet."}
        onRowClick={row => setSelectedID(selectedID === row.id ? "" : row.id)}
        rowClassName={row => selectedID === row.id ? "is-selected" : ""}
      />}
      <div className="changesets-list__foot"><span>{filtered.length} of {items.length} changesets</span><span><AlertTriangle size={12}/> Data from organization API</span></div>
    </div>
    {selected && <div className="changeset-detail card">
      <div className="changeset-detail__head"><div><h3>{selected.changeset.title}</h3><p>{selected.changeset.repository} · Created by {selected.changeset.created_by}</p></div><span className={statusClass(statusOf(selected.changeset))}>{statusOf(selected.changeset)}</span></div>
      <div className="changeset-steps">{["Repository", "Revision", "Evaluation", "Evidence", "Review", "Merge"].map((step, index) => <div key={step} className={["is-complete", currentRevision && index > 0 ? "is-complete" : "", currentEvaluation?.status === "passed" && index > 1 ? "is-complete" : "", activeEvidence && index > 2 ? "is-complete" : "", currentReview?.status === "approved" && index > 3 ? "is-complete" : "", selected.changeset.merge && index > 4 ? "is-complete" : ""].join(" ")}><span>{index + 1}</span><b>{step}</b></div>)}</div>
      <div className="changeset-workflow">
        <form onSubmit={event => { event.preventDefault(); void run(() => changesetAPI.addRevision(organization.id, selected.changeset.id, revisionRef), "Git revision resolved and persisted."); setRevisionRef(""); }}>
          <div><label><GitBranch size={14}/> Resolve Git ref</label><Input required value={revisionRef} onChange={event => setRevisionRef(event.target.value)} placeholder="branch, tag or commit SHA"/></div>
          <Button className="button secondary" disabled={busy || !!selected.changeset.merge}>Add revision</Button>
        </form>
        <div><label><Play size={14}/> Trusted evaluation</label><p>{currentEvaluation ? currentEvaluation.summary : "No evaluation for the current revision."}</p><Button className="button secondary" disabled={busy || !currentRevision || !!selected.changeset.merge} onClick={() => void run(() => changesetAPI.evaluate(organization.id, selected.changeset.id), "Trusted evaluation completed.")}>Run evaluation</Button></div>
        <div><label><FileCheck2 size={14}/> Evidence provenance</label><p>{activeEvidence ? selected.changeset.evidence.filter(value => value.revision_id === currentRevision?.id && value.status === "active").map(value => value.sha256 || value.uri).join(", ") : "Evidence is generated automatically from a passing evaluation report."}</p><span className="org-role">{activeEvidence ? "Verified artifact" : "Awaiting passing evaluation"}</span></div>
        <form onSubmit={event => { event.preventDefault(); void run(() => changesetAPI.assignReview(organization.id, selected.changeset.id, reviewerID, reviewComment), "Review assigned to an active organization member."); setReviewerID(""); setReviewComment(""); }}>
          <div><label><ShieldCheck size={14}/> Assign review (active member ID)</label><Input required value={reviewerID} onChange={event => setReviewerID(event.target.value)} placeholder="reviewer user ID"/><Input value={reviewComment} onChange={event => setReviewComment(event.target.value)} placeholder="Review context (optional)"/></div>
          <Button className="button secondary" disabled={busy || !activeEvidence || !!selected.changeset.merge}>Assign review</Button>
        </form>
        {currentReview && <div><label><ShieldCheck size={14}/> Review decision</label><p>Assigned to {currentReview.reviewer} · {currentReview.status}{currentReview.comment ? " · " + currentReview.comment : ""}</p>{currentReview.reviewer === accountUserID && currentReview.status === "pending" && <div className="org-actions"><Button className="button secondary" disabled={busy} onClick={() => void run(() => changesetAPI.decideReview(organization.id, selected.changeset.id, currentReview.id, true, decisionComment), "Review approved.")}>Approve</Button><Button className="button secondary" disabled={busy} onClick={() => void run(() => changesetAPI.decideReview(organization.id, selected.changeset.id, currentReview.id, false, decisionComment), "Changes requested.")}>Request changes</Button></div>}<Input value={decisionComment} onChange={event => setDecisionComment(event.target.value)} placeholder="Decision comment"/></div>}
        <form onSubmit={event => { event.preventDefault(); void run(() => changesetAPI.merge(organization.id, selected.changeset.id, targetRef), "Git merge completed and persisted."); }}>
          <div><label><GitMerge size={14}/> Merge target</label><Input required value={targetRef} onChange={event => setTargetRef(event.target.value)} placeholder="main"/></div>
          <Button className="button primary" disabled={busy || !canMerge}>Merge changeset</Button>
        </form>
      </div>
      {selected.changeset.merge && <div className="changeset-merge-result"><CheckCircle2 size={15}/> Merged as <code>{selected.changeset.merge.commit_sha}</code> into {selected.changeset.merge.target_ref}</div>}
      {selected.changeset.audit.length > 0 && <div className="changeset-audit"><h4>Lifecycle audit</h4>{selected.changeset.audit.slice().reverse().map(event => <div key={event.sequence}><span>{event.operation}</span><small>{event.actor} · {dateTime(event.at)}</small></div>)}</div>}
    </div>}
  </section>;
}
