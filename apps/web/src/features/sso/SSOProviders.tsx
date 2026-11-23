import { Github, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getEnabledProviders, type SSOProvider } from "../../shared/api/providers";
import { Alert } from "../../shared/ui";
import "./SSOProviders.css";

const googleMark = new URL("./google-g.png", import.meta.url).href;

export function SSOProviders({ divider, legacyLabel, returnPath }: {
  divider: string;
  legacyLabel: string;
  returnPath?: string;
}) {
  const { t } = useTranslation("login");
  const [providers, setProviders] = useState<SSOProvider[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getEnabledProviders(controller.signal)
      .then((enabled) => {
        if (!controller.signal.aborted) setProviders(enabled);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) return <Alert className="sso-discovery-status" status="warning">{t("providers.unavailable")}</Alert>;
  if (!providers.length) return null;

  return (
    <>
      <div className="sso-divider">{divider}</div>
      <div className="sso-providers">
        {providers.map(({ id, loginUrl }) => (
          <a
            key={id}
            href={returnPath && id !== "oidc" ? `${loginUrl}?${new URLSearchParams({ return: returnPath })}` : loginUrl}
            className="af-button af-button--secondary af-button--large"
          >
            {id === "google" && <img alt="" src={googleMark} width={18} height={18} />}
            {id === "github" && <Github aria-hidden="true" size={16} />}
            {id === "oidc" && <LockKeyhole aria-hidden="true" size={16} />}
            {id === "oidc" ? legacyLabel : t(`providers.${id}`)}
          </a>
        ))}
      </div>
    </>
  );
}
