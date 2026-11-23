import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui";
import { labelToNavKey } from "../navigation-labels";

type Props = { label: string; descriptionKey?: string; onCreate?: () => void; disabled?: boolean };

export function PageHeader({ label, descriptionKey, onCreate, disabled }: Props) {
  const { t } = useTranslation();
  const translatedLabel = t(labelToNavKey(label));
  const description = descriptionKey ? t(descriptionKey) : undefined;

  return (
    <div className="page-heading">
      <div>
        <h1>{translatedLabel}</h1>
        {description && <p>{description}</p>}
      </div>
      {onCreate && (
        <div className="heading-actions">
          <Button variant="primary" className="button primary" disabled={disabled} onClick={onCreate}>
            <Plus size={16} /> {t("common:actions.create")}
          </Button>
        </div>
      )}
    </div>
  );
}
