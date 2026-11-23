import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { settingsAPI, type SavedReply } from "../../shared/api/settings";
import { Button, Input, Modal } from "../../shared/ui";

export function IssueSavedReplies({ onCancel, onInsert }: { onCancel: () => void; onInsert: (body: string) => boolean }) {
  const { t } = useTranslation("settings");
  const [items, setItems] = useState<SavedReply[]>();
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tooLong, setTooLong] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    settingsAPI.listSavedReplies(controller.signal).then((replies) => {
      if (!controller.signal.aborted) setItems(replies);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadFailed(true);
    });
    return () => controller.abort();
  }, [retry]);

  const matches = items?.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Modal open title={t("savedReplies.title")} onCancel={onCancel}>
      {!loadFailed && (items?.length ?? 0) > 0 && <Input label={t("savedReplies.filter")} value={query} onChange={(event) => setQuery(event.target.value)} />}
      {loadFailed ? <div>
        <p role="alert">{t("savedReplies.loadFailed")}</p>
        <Button onClick={() => { setLoadFailed(false); setRetry((value) => value + 1); }}>{t("savedReplies.retry")}</Button>
      </div> : !matches ? <p role="status">{t("common:status.loading")}</p> : matches.length ? <ul className="issue-reply-options">
        {matches.map((item) => <li key={item.id}>
          <Button variant="ghost" onClick={() => setTooLong(!onInsert(item.body))}>{item.title}</Button>
        </li>)}
      </ul> : <p role="status">{t(items?.length ? "savedReplies.noMatches" : "savedReplies.empty")}</p>}
      {tooLong && <p role="alert">{t("savedReplies.insertTooLong")}</p>}
      <Link to="/settings/saved-replies" target="_blank" rel="noopener">{t("savedReplies.manage")}</Link>
    </Modal>
  );
}
