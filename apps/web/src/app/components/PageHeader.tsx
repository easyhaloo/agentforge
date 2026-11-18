import { Activity, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui";

type Props = { label: string; description?: string; onRefresh?: () => void; onCreate?: () => void };

/** Maps route label identifiers to translation keys. Route labels are stable English identifiers; this maps them to i18n keys. */
const labelToTranslationKey = (label: string): string => {
  const keyMap: Record<string, string> = {
    "Overview": "navigation:routes.overview",
    "Projects": "navigation:routes.projects",
    "Workspaces": "navigation:routes.workspaces",
    "Stacks": "navigation:routes.stacks",
    "Self-healing": "navigation:routes.selfHealing",
    "Memory": "navigation:routes.memory",
    "CI / CD": "navigation:routes.cicd",
    "Security": "navigation:routes.security",
    "Governance": "navigation:routes.governance",
    "Cost & Usage": "navigation:routes.usage",
    "Settings": "navigation:routes.settings",
    "Changesets": "navigation:routes.changesets",
    "Changeset": "navigation:routes.changeset",
    "Repositories": "navigation:routes.repositories",
    "Trails": "navigation:routes.trails",
    "Review": "navigation:routes.review",
    "Eval": "navigation:routes.eval",
    "Organization": "navigation:routes.organization",
    "UI Components": "navigation:routes.uiComponents",
    "Page not found": "navigation:routes.notFound",
  };
  return keyMap[label] || label;
};

export function PageHeader({ label, description, onRefresh, onCreate }: Props) {
  const { t } = useTranslation();
  const translatedLabel = t(labelToTranslationKey(label));

  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">AGENTFORGE / {translatedLabel.toUpperCase()}</div>
        <h1>{translatedLabel}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">
        {onRefresh && (
          <Button className="button secondary" onClick={onRefresh}>
            <Activity size={15} /> {t("common:actions.refresh")}
          </Button>
        )}
        {onCreate && (
          <Button variant="primary" className="button primary" onClick={onCreate}>
            <Plus size={16} /> {t("changesets:create.createButton")}
          </Button>
        )}
      </div>
    </div>
  );
}
