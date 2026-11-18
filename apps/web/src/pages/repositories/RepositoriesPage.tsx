import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Code2, Plus, RefreshCw } from "lucide-react";
import { repositoryAPI, type OrganizationSummary, type RepositoryMetadata } from "../../shared/api/identity";
import { Button, DataTable, Input } from "../../shared/ui";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };

/** The repositories the organization may create changesets in, and how a new one is registered. */
export function RepositoriesPage({ organization, onNotify }: Props) {
  const [items, setItems] = useState<RepositoryMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [slug, setSlug] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
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
        { key: "slug", title: "REPOSITORY", render: (_value, item) => <b>{item.slug}</b> },
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
  </section>;
}
