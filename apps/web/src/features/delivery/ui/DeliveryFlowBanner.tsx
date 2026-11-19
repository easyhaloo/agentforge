import { Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";

export function DeliveryFlowBanner() {
  const { t } = useTranslation("common");
  return <div className="flow-banner">
    <div className="flow-banner-icon"><Workflow size={19} /></div>
    <div><b>{t("delivery.banner.title")}</b><p>{t("delivery.banner.description")}</p></div>
    <span className="demo-pill">{t("delivery.banner.demoBadge")}</span>
  </div>;
}
