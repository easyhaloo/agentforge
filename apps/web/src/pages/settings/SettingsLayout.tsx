import { useTranslation } from "react-i18next";
import { Select } from "../../shared/ui";
import type { OrganizationSummary } from "../../shared/api/identity";
import { organizationHandle, orgPath } from "../../shared/routing";
import { Link, Outlet } from "react-router-dom";
import { SettingsSidebar } from "./SettingsSidebar";
import "./settings.css";

export interface SettingsOutletContext {
  updateDisplayName?: (name: string) => void;
  notify: (message: string) => void;
  /** The whole account so settings pages (e.g. 我的组织) can list organizations. */
  organizations: OrganizationSummary[];
  reload?: () => Promise<void>;
}

type Props = SettingsOutletContext & {
  organizations: OrganizationSummary[];
  displayName: string;
  selectedOrganization?: OrganizationSummary;
  selectOrganization?: (id: string) => void;
};

export function SettingsLayout({ organizations, displayName, selectedOrganization, selectOrganization, notify, updateDisplayName, reload }: Props) {
  const { t } = useTranslation("settings");
  const organizationName = (org: OrganizationSummary) => org.personal && displayName.trim()
    ? t("nav.personalWorkspace", { name: displayName })
    : org.name;
  return (
    <div className="settings-layout">
      {selectedOrganization && (
        <div className="settings-context">
          {organizations.length > 1 ? (
            <Select label={t("nav.currentOrganization")} value={selectedOrganization.id}
              options={organizations.map(org => ({ value: org.id, label: organizationName(org) }))}
              onChange={event => selectOrganization?.(event.target.value)}
            />
          ) : (
            <dl>
              <dt className="af-field__label">{t("nav.currentOrganization")}</dt>
              <dd>{organizationName(selectedOrganization)}</dd>
            </dl>
          )}
          <Link to={orgPath(organizationHandle(selectedOrganization), "settings")}>{t("navigation:userMenu.organization")}</Link>
        </div>
      )}
      <aside className="settings-sidebar">
        <SettingsSidebar />
      </aside>
      <main className="settings-content">
        <Outlet context={{ notify, updateDisplayName, organizations, reload }} />
      </main>
    </div>
  );
}
