import { ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select } from "../../shared/ui";
import type { OrganizationSummary } from "../../shared/api/identity";
import { organizationHandle, orgPath } from "../../shared/routing";
import { Outlet, useNavigate } from "react-router-dom";
import { SettingsSidebar } from "./SettingsSidebar";
import "./settings.css";

export interface SettingsOutletContext {
  updateDisplayName?: (name: string) => void;
  notify: (message: string) => void;
}

export function SettingsLayout({ organizations, ...context }: SettingsOutletContext & { organizations: OrganizationSummary[] }) {
  const navigate = useNavigate();
  const { t } = useTranslation("settings");
  return (
    <div className="settings-layout">
      {organizations.length > 0 && (
        <div className="settings-context">
          <ArrowLeftRight size={16} aria-hidden="true" />
          <Select aria-label={t("nav.switchContext")} value=""
            options={[
              { value: "", label: t("nav.switchContext"), disabled: true },
              ...organizations.map(org => ({ label: org.name, value: orgPath(organizationHandle(org), "settings") })),
            ]}
            onChange={event => navigate(event.target.value)}
          />
        </div>
      )}
      <aside className="settings-sidebar">
        <SettingsSidebar />
      </aside>
      <main className="settings-content">
        <Outlet context={context} />
      </main>
    </div>
  );
}
