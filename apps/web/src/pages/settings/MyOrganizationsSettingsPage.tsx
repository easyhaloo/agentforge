import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import { Building2, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../../shared/ui";
import { organizationLifecycleAPI, type LifecycleStatus } from "../../shared/api/organizationLifecycle";
import { orgPath, organizationHandle } from "../../shared/routing";
import { translateError } from "../../shared/api/errors";
import type { OrganizationSummary } from "../../shared/api/identity";
import type { SettingsOutletContext } from "./SettingsLayout";

/** The account context carries the lifecycle status once the backend returns it. */
export type OrganizationSummaryWithStatus = OrganizationSummary & { status?: LifecycleStatus };

/** "我的组织" page under personal settings (SPEC section 4). */
export function MyOrganizationsSettingsPage() {
  const { t } = useTranslation("settings");
  const { organizations: contextOrganizations, notify, reload } = useOutletContext<SettingsOutletContext & { organizations: OrganizationSummary[]; reload?: () => Promise<void> }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const organizations = (contextOrganizations ?? []) as OrganizationSummaryWithStatus[];

  const cancelDeletion = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      await organizationLifecycleAPI.cancelDeletion(id);
      await reload?.();
      notify(t("settings:lifecycle.danger.cancelDeletion.success"));
    } catch (cause) {
      setError(translateError(cause, t, "settings:myOrgs.cancelDeletionFailed"));
    } finally {
      setBusy("");
    }
  };

  return <div className="settings-page">
    <header className="settings-page-header">
      <h1 className="settings-page-title">{t("settings:myOrgs.title")}</h1>
      <p className="settings-page-description">{t("settings:myOrgs.description")}</p>
    </header>
    {error && <div role="alert">{error}</div>}
    <div className="settings-stack">
      {/* Self-service creation is server-gated; until the capability flag ships, render inactive with the reason. */}
      <Button
        inactive
        inactiveReason={t("settings:myOrgs.createInactiveReason")}
        title={t("settings:myOrgs.createInactiveTitle")}
      >
        {t("settings:myOrgs.create")}
      </Button>
      {!organizations.length && <p className="settings-placeholder">{t("settings:myOrgs.empty")}</p>}
      <ul className="org-my-list">
        {organizations.map((org) => {
          const roleLabel = t(`settings:roles.${org.role}`);
          const statusLabel = t(`settings:statuses.${org.status ?? "active"}`);
          return (
            <li key={org.id} className="org-my-row">
              <span className="org-my-row__icon" aria-hidden="true"><Building2 size={20} /></span>
              <div className="org-my-row__copy">
                <strong>
                  <Link to={orgPath(organizationHandle(org), "settings")}>{org.name}</Link>{" "}
                  <span className="org-label">{roleLabel}</span>
                  {org.status && org.status !== "active" && (
                    <span className={`org-label ${org.status === "pending_deletion" ? "org-label--danger" : "org-label--warning"}`}>
                      {org.status === "pending_deletion" ? t("settings:myOrgs.daysRemaining", { days: "30" }) : statusLabel}
                    </span>
                  )}
                </strong>
              </div>
              <Link className="af-button af-button--secondary" to={orgPath(organizationHandle(org), "settings")}>
                <Settings size={14} aria-hidden="true" /> {t("settings:myOrgs.settings")}
              </Link>
              {org.status === "pending_deletion" && org.role === "owner" && (
                <Button size="small" loading={busy === org.id} onClick={() => void cancelDeletion(org.id)}>
                  {t("settings:myOrgs.cancelDeletion")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  </div>;
}
