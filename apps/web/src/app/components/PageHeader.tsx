import { Activity, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui";
import { labelToNavKey } from "../navigation-labels";

type Props = { label: string; descriptionKey?: string; onRefresh?: () => void; onCreate?: () => void };

export function PageHeader({ label, descriptionKey, onRefresh, onCreate }: Props) {
  const { t } = useTranslation();
  const translatedLabel = t(labelToNavKey(label));
  const description = descriptionKey ? t(descriptionKey) : undefined;

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
