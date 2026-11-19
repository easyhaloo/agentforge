import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Code2, Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { repositoryAPI, type OrganizationSummary, type RepositoryMetadata } from "../../shared/api/identity";
import { Button, DataTable, Input } from "../../shared/ui";

type Props = { organization: OrganizationSummary; onNotify: (message: string) => void };

/** The repositories the organization may create changesets in, and how a new one is registered. */
export function RepositoriesPage({ organization, onNotify }: Props) {
  const { t } = useTranslation("repositories");
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
      setError(cause instanceof Error ? cause.message : t("feedback.loadFailed"));
    } finally { setLoading(false); }
  }, [organization.id, t]);
  useEffect(() => { void load(); }, [load]);

  const register = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const added = await repositoryAPI.register(organization.id, slug.trim(), defaultBranch.trim());
      setItems(current => [...current, added]);
      setSlug("");
      onNotify(t("feedback.registered"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("feedback.registrationFailed"));
    } finally { setBusy(false); }
  };

  return <section className="org-admin">
    <div className="org-admin-summary card">
      <div className="org-admin-summary__icon"><Code2 size={19}/></div>
      <div><h2>{t("page.title")}</h2><p>{t("page.description")}</p></div>
      <span className="org-role">{organization.role}</span>
      <Button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/> {t("common:actions.refresh")}</Button>
    </div>
    {error && <div className="org-error" role="alert">{error}</div>}
    {canRegister && <form className="org-invite-form" onSubmit={register}>
      <Input label={t("form.slugLabel")} required pattern="[^/]+/[^/]+" value={slug} onChange={event => setSlug(event.target.value)} placeholder={t("form.slugPlaceholder")}/>
      <Input label={t("form.branchLabel")} required value={defaultBranch} onChange={event => setDefaultBranch(event.target.value)} placeholder={t("form.branchPlaceholder")}/>
      <Button className="button primary" type="submit" disabled={busy}><Plus size={14}/> {t("form.registerButton")}</Button>
    </form>}
    {!canRegister && <p className="changeset-hint">{t("page.restrictedNotice")}</p>}
    <DataTable
      className="org-table"
      columns={[
        { key: "slug", title: t("columns.repository"), render: (_value, item) => <b>{item.slug}</b> },
        { key: "default_branch", title: t("columns.branch") },
        { key: "created_by", title: t("columns.registeredBy") },
        { key: "created_at", title: t("columns.registered") },
      ]}
      data={items}
      rowKey="slug"
      loading={loading}
      emptyText={t("empty")}
      showColumnVisibility={false}
    />
  </section>;
}
