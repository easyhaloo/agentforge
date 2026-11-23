import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { settingsAPI, type SavedReply } from "../../shared/api/settings";
import { translateError } from "../../shared/api/errors";
import { Button, Input, Modal, TextArea } from "../../shared/ui";

const emptyDraft = { id: "", title: "", body: "" };

export function SavedRepliesSettingsPage() {
  const { t } = useTranslation("settings");
  const [items, setItems] = useState<SavedReply[]>();
  const [draft, setDraft] = useState(emptyDraft);
  const [pendingDelete, setPendingDelete] = useState<SavedReply>();
  const [retry, setRetry] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    settingsAPI.listSavedReplies(controller.signal).then((replies) => {
      if (!controller.signal.aborted) setItems(replies);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadFailed(true);
    });
    return () => controller.abort();
  }, [retry]);

  const validDraft = draft.title.trim() && [...draft.title.trim()].length <= 100 && draft.body.trim();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !validDraft) return;
    setSaving(true);
    setSaveError("");
    try {
      const reply = await settingsAPI.saveReply(draft);
      setItems((previous) => draft.id ? previous?.map((item) => item.id === reply.id ? reply : item) : [reply, ...previous ?? []]);
      setDraft(emptyDraft);
    } catch (cause) {
      setSaveError(translateError(cause, t, "savedReplies.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("savedReplies.title")}</h1>
        <p className="settings-page-description">{t("savedReplies.description")}</p>
      </header>
      <div className="settings-stack">
        {loadFailed ? <div className="settings-placeholder" role="alert">
          <p>{t("savedReplies.loadFailed")}</p>
          <Button onClick={() => { setLoadFailed(false); setRetry((value) => value + 1); }}>{t("savedReplies.retry")}</Button>
        </div> : !items ? <p role="status">{t("common:status.loading")}</p> : <>
          {items.length ? <ul className="settings-box">
            {items.map((item) => <li className="settings-box-row access-row" key={item.id}>
              <strong>{item.title}</strong>
              <div>
                <Button disabled={saving} aria-label={t("savedReplies.editNamed", { title: item.title })} onClick={() => { setDraft(item); setSaveError(""); }}>{t("common:actions.edit")}</Button>
                <Button disabled={saving} aria-label={t("savedReplies.deleteNamed", { title: item.title })} onClick={() => setPendingDelete(item)}>{t("common:actions.delete")}</Button>
              </div>
            </li>)}
          </ul> : <p>{t("savedReplies.empty")}</p>}
          <section>
            <h2 className="settings-section-heading">{t(draft.id ? "savedReplies.edit" : "savedReplies.add")}</h2>
            <form onSubmit={save} className="settings-stack">
              <Input label={t("savedReplies.replyTitle")} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required disabled={saving} />
              <TextArea label={t("savedReplies.replyBody")} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} required maxLength={16384} rows={5} disabled={saving} />
              {saveError && <p role="alert">{saveError}</p>}
              <div>
                <Button type="submit" variant="primary" loading={saving} disabled={!validDraft}>{t("savedReplies.save")}</Button>
                {draft.id && <Button disabled={saving} onClick={() => { setDraft(emptyDraft); setSaveError(""); }}>{t("common:actions.cancel")}</Button>}
              </div>
            </form>
          </section>
        </>}
      </div>
      {pendingDelete && <Modal open title={t("savedReplies.deleteNamed", { title: pendingDelete.title })}
        okText={t("common:actions.delete")} okVariant="danger" onCancel={() => setPendingDelete(undefined)}
        onOk={async () => {
          await settingsAPI.deleteSavedReply(pendingDelete.id);
          setItems((previous) => previous?.filter((item) => item.id !== pendingDelete.id));
          if (draft.id === pendingDelete.id) {
            setDraft(emptyDraft);
            setSaveError("");
          }
          setPendingDelete(undefined);
        }}>
        <p>{t("savedReplies.deleteConfirm")}</p>
      </Modal>}
    </div>
  );
}
