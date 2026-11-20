import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function DeliveryFlowFooter() {
  const { t } = useTranslation("common");
  return <div className="flow-bottom-note"><CheckCircle2 size={14} />
    {t("delivery.footer.hint")}
  </div>;
}
