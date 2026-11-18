import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw, GitCommitHorizontal, GitBranch, Play, ShieldCheck, GitMerge, CheckCircle2, AlertTriangle, FileCheck2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { changesetAPI, changesetStatuses, repositoryAPI, type OrganizationSummary, type RepositoryMetadata, type StoredChangeset } from "../../shared/api/identity";
import { Button, Input, SearchInput, Select } from "../../shared/ui";
import { ChangesetTable, changesetRows } from "./ui/ChangesetTable";
import { changesetStatusClass, changesetStatusLabels } from "./changeset-status";
import { CHANGESET_QUERY_MAX, readChangesetFilters, writeChangesetFilters, type ChangesetFilters } from "./changeset-filters";

type Props = { organization: OrganizationSummary; accountUserID: string; onNotify: (message: string) => void };

const dateTime = (value: string) => new Date(value).toLocaleString();

export function ChangesetsPage({ organization, accountUserID, onNotify }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readChangesetFilters(searchParams);
  const [queryDraft, setQueryDraft] = useState(filters.q);
  const [items, setItems] = useState<StoredChangeset[]>([]);
  const [total, setTotal] = useState(0);
  const [repositories, setRepositories] = useState<RepositoryMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [repository, setRepository] = useState("");
  const [title, setTitle] = useState("");
  const [repoSlug, setRepoSlug] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [selectedID, setSelectedID] = useState("");
  const [revisionRef, setRevisionRef] = useState("");
  const [reviewerID, setReviewerID] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [targetRef, setTargetRef] = useState("main");
  const [decisionComment, setDecisionComment] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const canManageRepositories = organization.role === "owner" || organization.role === "admin";
  const selected = items.find(item => item.changeset.id === selectedID);
  const rows = changesetRows(items);
  const selectedStatus = rows.find(row => row.id === selectedID)?.status ?? "";
  const page = Math.floor(filters.offset / filters.limit) + 1;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [page, repoPage] = await Promise.all([
        changesetAPI.list(organization.id, {
          q: filters.q, repository: filters.repository, status: filters.status || undefined, reviewer: filters.reviewer,
          limit: filters.limit, offset: filters.offset,
        }),
        repositoryAPI.list(organization.id),
      ]);
      setItems(page.items); setTotal(page.total); setRepositories(repoPage.items);
      setRepository(current => current || repoPage.items[0]?.slug || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load delivery data"); }
    finally { setLoading(false); }
  }, [organization.id, filters.q, filters.repository, filters.status, filters.reviewer, filters.limit, filters.offset, reloadToken]);
  useEffect(() => { void load(); }, [load]);
  // The URL owns the search term; the field is the edit buffer of the term the URL carries.
  useEffect(() => { setQueryDraft(filters.q); }, [filters.q]);

  /** Every filter change is a URL change, so the list stays linkable and survives a reload. */
  const applyFilters = (patch: Partial<ChangesetFilters>) => setSearchParams(writeChangesetFilters(patch, searchParams));

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
    setBusy(true); setError("");
    try {
      await changesetAPI.create(organization.id, repository, title.trim());
      setTitle("");
      onNotify("Changeset created and persisted.");
      // A new changeset belongs to an unfiltered list, so the list starts again and shows it.
      if (filters.q || filters.repository || filters.status || filters.reviewer || filters.offset) {
        setSearchParams(writeChangesetFilters({ offset: 0 }, new URLSearchParams()), { replace: true });
      }
      setReloadToken(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Changeset creation failed"); }
    finally { setBusy(false); }
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

  const currentRevision = selected?.changeset.revisions.slice(-1)[0];
  const currentEvaluation = currentRevision && selected?.changeset.evaluations.filter(value => value.revision_id === currentRevision.id).slice(-1)[0];
  const currentReview = currentRevision && selected?.changeset.reviews.filter(value => value.revision_id === currentRevision.id).slice(-1)[0];
  const activeEvidence = !!(currentRevision && selected?.changeset.evidence.some(value => value.revision_id === currentRevision.id && value.status === "active"));
  const canMerge = !!(currentRevision && currentEvaluation?.status === "passed" && activeEvidence && currentReview?.status === "approved" && !selected?.changeset.merge);

  return <section className="changesets-page">
    <div className="changesets-summary card">
      <div className="changesets-summary__icon"><GitCommitHorizontal size={20}/></div>
      <div><b>{total} persisted changesets</b><p>Organization-scoped Git lifecycle · PostgreSQL state</p></div>
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
        <div className="changesets-filters">
          <SearchInput value={queryDraft} onChange={setQueryDraft} onSearch={value => applyFilters({ q: value.slice(0, CHANGESET_QUERY_MAX) })} placeholder="Search ID, title or repository" className="changesets-search"/>
          <Select aria-label="Filter by status" placeholder="All statuses" value={filters.status} onChange={event => applyFilters({ status: event.target.value as ChangesetFilters["status"] })} options={changesetStatuses.map(status => ({ value: status, label: changesetStatusLabels[status] }))}/>
          <Select aria-label="Filter by repository" placeholder="All repositories" value={filters.repository} onChange={event => applyFilters({ repository: event.target.value })} options={repositories.map(item => ({ value: item.slug, label: item.slug }))}/>
          <Button className="button secondary" aria-pressed={filters.reviewer === "me" && filters.status === "in_review"} onClick={() => applyFilters({ reviewer: "me", status: "in_review" })}>My pending reviews</Button>
        </div>
      </div>
      {loading ? <div className="org-loading">Loading changesets…</div> : <ChangesetTable
        items={items}
        total={total}
        page={page}
        pageSize={filters.limit}
        onPageChange={(nextPage, pageSize) => applyFilters({ limit: pageSize, offset: (nextPage - 1) * pageSize })}
        onOpen={id => setSelectedID(selectedID === id ? "" : id)}
      />}
      <div className="changesets-list__foot"><span>{rows.length} of {total} changesets</span><span><AlertTriangle size={12}/> Data from organization API</span></div>
    </div>
    {selected && <div className="changeset-detail card">
      <div className="changeset-detail__head"><div><h3>{selected.changeset.title}</h3><p>{selected.changeset.repository} · Created by {selected.changeset.created_by}</p></div><span className={changesetStatusClass(selectedStatus)}>{selectedStatus}</span></div>
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
