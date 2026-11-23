import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { APIError, translateError } from "../../shared/api/errors";
import { repositoryWebhooksAPI, type RepositoryWebhook, type WebhookDelivery, type WebhookEvent, type WebhookUpdate } from "../../shared/api/repository-webhooks";
import { Button, Checkbox, Input } from "../../shared/ui";

const events: WebhookEvent[] = ["issues", "issue_comment"];

export function RepositoryWebhooks({ organization, repository }: { organization: string; repository: string }) {
  const { t, i18n } = useTranslation("repositories");
  const api = useMemo(() => repositoryWebhooksAPI(organization, repository), [organization, repository]);
  const [hooks, setHooks] = useState<RepositoryWebhook[]>();
  const [edit, setEdit] = useState<RepositoryWebhook | "new">();
  const [history, setHistory] = useState<{ id: string; items?: WebhookDelivery[]; error?: string }>();
  const [confirm, setConfirm] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void api.list(controller.signal).then(items => {
      if (!controller.signal.aborted) setHooks(items);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(translateError(cause, t, "repositories:webhooks.loadError"));
    });
    return () => controller.abort();
  }, [api, retry, t]);

  async function save(id: string | undefined, data: WebhookUpdate) {
    setBusy(true);
    setError("");
    try {
      const hook = await api.save(id, data);
      setHooks(items => id ? (items ?? []).map(item => item.id === id ? hook : item) : [hook, ...(items ?? [])]);
      setEdit(undefined);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof APIError && [400, 422].includes(cause.status)
        ? t("webhooks.invalid") : translateError(cause, t, "repositories:webhooks.saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await api.remove(id);
      setHooks(items => (items ?? []).filter(item => item.id !== id));
      setConfirm(undefined);
      setSaved(true);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:webhooks.saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory(id: string) {
    setHistory({ id });
    try {
      const items = await api.deliveries(id);
      setHistory(current => current?.id === id ? { id, items } : current);
    } catch (cause) {
      const error = translateError(cause, t, "repositories:webhooks.historyError");
      setHistory(current => current?.id === id ? { id, error } : current);
    }
  }

  return <section aria-label={t("webhooks.title")} className="repo-settings-card repo-webhooks">
    <p>{t("webhooks.description")}</p>
    {error && <p role="alert" className="org-error">{error}</p>}
    {saved && <p role="status">{t("webhooks.saved")}</p>}
    {!hooks ? error ? <Button onClick={() => { setError(""); setRetry(value => value + 1); }}>{t("common:actions.retry")}</Button>
      : <p role="status">{t("common:components.loading")}</p> : <>
      {!edit && <Button variant="primary" onClick={() => { setEdit("new"); setError(""); setSaved(false); }}>{t("webhooks.add")}</Button>}
      {edit && <WebhookForm key={edit === "new" ? edit : edit.id} hook={edit === "new" ? undefined : edit} busy={busy}
        onSubmit={data => void save(edit === "new" ? undefined : edit.id, data)} onCancel={() => { setEdit(undefined); setError(""); }} />}
      {!hooks.length && !edit && <p>{t("webhooks.empty")}</p>}
      {hooks.map(hook => <article key={hook.id} className="repo-webhook">
        <strong className="repo-webhook-url">{hook.url}</strong>
        <p>{t(hook.active ? "webhooks.active" : "webhooks.inactive")} · {hook.events.map(event => t(`webhooks.events.${event}`)).join(", ")}</p>
        <div className="repo-webhook-actions">
          <Button disabled={busy || Boolean(edit)} onClick={() => { setEdit(hook); setSaved(false); setError(""); }}>{t("webhooks.edit")}</Button>
          <Button disabled={busy} onClick={() => history?.id === hook.id ? setHistory(undefined) : void loadHistory(hook.id)}
            aria-expanded={history?.id === hook.id}>
            {t("webhooks.history")}
          </Button>
          <Button disabled={busy || Boolean(edit)} onClick={() => { setConfirm(hook.id); setSaved(false); }}>{t("webhooks.remove")}</Button>
        </div>
        {confirm === hook.id && <div className="repo-webhook-actions">
          <p>{t("webhooks.confirm")}</p>
          <Button disabled={busy} onClick={() => void remove(hook.id)}>{t("webhooks.confirmRemove")}</Button>
          <Button disabled={busy} onClick={() => setConfirm(undefined)}>{t("common:actions.cancel")}</Button>
        </div>}
        {history?.id === hook.id && <div className="repo-webhook-history">
          <Button disabled={!history.items && !history.error} onClick={() => void loadHistory(hook.id)}>{t("webhooks.refreshHistory")}</Button>
          {history.error ? <p role="alert" className="org-error">{history.error}</p>
            : !history.items ? <p role="status">{t("common:components.loading")}</p>
            : !history.items.length ? <p>{t("webhooks.noDeliveries")}</p>
            : <ul>{history.items.map(item => <li key={item.id}>
              <time dateTime={item.created_at}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(new Date(item.created_at))}</time>
              {" · "}{t(`webhooks.events.${item.event}`)}{" · "}{t(`webhooks.status.${item.status}`, { defaultValue: item.status })}
              {item.http_status ? ` (HTTP ${item.http_status})` : ""}
            </li>)}</ul>}
        </div>}
      </article>)}
    </>}
  </section>;
}

function WebhookForm({ hook, busy, onSubmit, onCancel }: {
  hook?: RepositoryWebhook; busy: boolean; onSubmit: (data: WebhookUpdate) => void; onCancel: () => void;
}) {
  const { t } = useTranslation("repositories");
  const [url, setURL] = useState(hook?.url ?? "");
  const [secret, setSecret] = useState("");
  const [selected, setSelected] = useState<WebhookEvent[]>(hook?.events ?? ["issues"]);
  const [active, setActive] = useState(hook?.active ?? true);
  return <form className="repo-settings-form repo-webhook-form" aria-label={t(hook ? "webhooks.edit" : "webhooks.add")}
    onSubmit={event => { event.preventDefault(); if (!busy && selected.length) onSubmit({ url, events: selected, active, ...(secret ? { secret } : {}) }); }}>
    <Input type="url" label={t("webhooks.url")} value={url} onChange={event => setURL(event.target.value)} required maxLength={2048} />
    <Input type="password" label={t("webhooks.secret")} hint={t(hook ? "webhooks.replaceSecret" : "webhooks.secretHelp")}
      value={secret} onChange={event => setSecret(event.target.value)} autoComplete="new-password" required={!hook} minLength={16} maxLength={256} />
    <fieldset>
      <legend>{t("webhooks.subscriptions")}</legend>
      {events.map(kind => <Checkbox key={kind} label={t(`webhooks.events.${kind}`)} checked={selected.includes(kind)}
        onChange={event => setSelected(items => event.target.checked ? [...items, kind] : items.filter(item => item !== kind))} />)}
    </fieldset>
    <Checkbox label={t("webhooks.active")} checked={active} onChange={event => setActive(event.target.checked)} />
    <div className="repo-webhook-actions">
      <Button variant="primary" type="submit" disabled={busy || !selected.length}>{t("common:actions.save")}</Button>
      <Button onClick={onCancel} disabled={busy}>{t("common:actions.cancel")}</Button>
    </div>
  </form>;
}
