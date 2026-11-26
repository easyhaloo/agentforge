import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button } from "../../../shared/ui";
import { adminIdentityAPI, type IdentityStatus } from "../../../shared/api/organizationLifecycle";
import { translateError } from "../../../shared/api/errors";

/** Read-only identity-provider page for platform operations (SPEC section 4). */
export function AdminIdentityPage() {
  const { t } = useTranslation("settings");
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  const load = (recheck: boolean) => {
    if (recheck) setRechecking(true);
    setError("");
    void (recheck ? adminIdentityAPI.recheck() : adminIdentityAPI.status()).then(
      (next) => { setStatus(next); setRechecking(false); },
      (cause) => {
        setRechecking(false);
        if (cause instanceof Error && "status" in cause && (cause as { status?: number }).status === 404) setForbidden(true);
        else setError(translateError(cause, t, "settings:identity.loadFailed"));
      },
    );
  };

  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (forbidden) {
    return <div className="org-lifecycle-page" role="alert">{t("settings:identity.forbidden")}</div>;
  }

  const statusLabel = (value: "ok" | "fail" | "warn") => value === "ok" ? t("settings:identity.status.ok") : value === "fail" ? t("settings:identity.status.fail") : t("settings:identity.status.warn");

  return <div className="org-lifecycle-page">
    <h2 className="org-lifecycle-subhead">{t("settings:identity.title")}</h2>
    <p className="org-lifecycle-description">{t("settings:identity.subtitle")} — {t("settings:identity.description")}</p>
    {error && <div className="org-lifecycle-error" role="alert">{error}</div>}
    {status && !status.ready && <Alert status="error" dismissible={false} className="org-lifecycle-banner">{t("settings:identity.notReadyBanner")}</Alert>}

    {status && <section className="org-identity-box" aria-label={t("settings:identity.configTitle")}>
      <header className="org-identity-box__header">
        <h3>{t("settings:identity.configTitle")}</h3>
        <span className={`org-label ${status.ready ? "org-label--success" : "org-label--danger"}`}>
          {status.ready ? t("settings:identity.effective") : t("settings:identity.incomplete")}
        </span>
      </header>
      <div className="org-identity-kv">
        <span>{t("settings:identity.fields.appOrigin")}</span>
        <code>{status.app_origin || "—"}</code>
      </div>
      {status.providers.map((provider) => (
        <div key={provider.id} className="org-identity-kv">
          <span>{provider.id}</span>
          <span>
            <code>{provider.issuer_url || provider.login_url || provider.id}</code>{" "}
            <span className={`org-label ${provider.active ? "org-label--success" : "org-label--warning"}`}>
              {provider.active ? t("settings:identity.showing") : t("settings:identity.hiddenIncomplete")}
            </span>
          </span>
        </div>
      ))}
    </section>}

    {status && <section className="org-identity-box" aria-label={t("settings:identity.checksTitle")}>
      <header className="org-identity-box__header">
        <h3>{t("settings:identity.checksTitle")}</h3>
        <Button size="small" loading={rechecking} onClick={() => load(true)}>
          {rechecking ? t("settings:identity.rechecking") : t("settings:identity.recheck")}
        </Button>
      </header>
      <ul className="org-identity-checks">
        {status.checks.map((check) => (
          <li key={`${check.name}-${check.status}`} className={`org-identity-check org-identity-check--${check.status}`}>
            <span aria-hidden="true">{check.status === "ok" ? "✓" : check.status === "warn" ? "!" : "×"}</span>
            <div>
              <strong>{check.name}</strong>
              {check.detail && <p>{check.detail}</p>}
              {check.error && <p className="org-identity-check__error">{check.error}</p>}
            </div>
            {check.duration && <span className="org-identity-check__duration">{check.duration}</span>}
            <span className="org-sr-only">{statusLabel(check.status)}</span>
          </li>
        ))}
      </ul>
    </section>}
  </div>;
}
