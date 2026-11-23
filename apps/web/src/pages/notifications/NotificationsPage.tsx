import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type { OrganizationSummary } from "../../shared/api/identity";
import { notificationsAPI } from "../../shared/api/notifications";
import { issueDetailPath, organizationHandle } from "../../shared/routing";
import { Alert, Button, Empty, Loading } from "../../shared/ui";

export function NotificationsPage({ organization }: { organization: OrganizationSummary }) {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<Awaited<ReturnType<typeof notificationsAPI.list>>>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [readFailed, setReadFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setList(undefined);
    setLoadFailed(false);
    setReadFailed(false);
    void notificationsAPI.list(organization.id, offset, controller.signal).then((result) => {
      if (!controller.signal.aborted) setList(result);
    }, () => {
      if (!controller.signal.aborted) setLoadFailed(true);
    });
    return () => controller.abort();
  }, [organization.id, offset, attempt]);

  if (loadFailed) return <Alert status="error">
    {t("inbox.loadFailed")} <Button onClick={() => setAttempt(attempt + 1)}>{t("app:organizationGate.retry")}</Button>
  </Alert>;
  if (!list) return <Loading />;
  if (!list.items.length) return <Empty title={t("inbox.empty")} />;

  return <section className="card" aria-label={t("routes.inbox")}>
    {readFailed && <Alert status="error">{t("inbox.readFailed")}</Alert>}
    <ul>
      {list.items.map((item) => {
        const href = issueDetailPath(organizationHandle(organization), item.repository, item.issue_number);
        return <li key={item.id}>
          <Link to={href} onClick={(event) => {
            if (!item.unread || event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
            event.preventDefault();
            setReadFailed(false);
            void notificationsAPI.markRead(organization.id, item.id).then(() => navigate(href), () => setReadFailed(true));
          }}>{item.issue_title}</Link>
          <div>{item.repository} #{item.issue_number} · {item.reason === "mentioned" ? `${t("inbox.mentioned")} · ` : ""}
            {item.unread ? t("inbox.unread") : t("inbox.read")}</div>
        </li>;
      })}
    </ul>
    {list.total > list.limit && <div>
      <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - list.limit))}>{t("inbox.previous")}</Button>
      <Button disabled={offset + list.limit >= list.total} onClick={() => setOffset(offset + list.limit)}>{t("inbox.next")}</Button>
    </div>}
  </section>;
}
