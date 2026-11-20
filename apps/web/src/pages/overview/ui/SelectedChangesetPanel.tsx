import { ArrowRight, GitPullRequest } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui";

type Props = {
  changesetId: string;
  onNotify: (message: string) => void;
};

export function SelectedChangesetPanel({ changesetId, onNotify }: Props) {
  const { t } = useTranslation("overview");
  return (
    <section className="detail-strip card">
      <div className="detail-icon"><GitPullRequest size={18} /></div>
      <div>
        <b>{changesetId} <span className="detail-title">{t("selectedChangeset.label")}</span></b>
        <p>{t("selectedChangeset.summary", { revision: 3, base: "main", files: 12, checks: 42 })}</p>
      </div>
      <div className="detail-right">
        <span className="status success"><i />{t("selectedChangeset.evidenceCurrent")}</span>
        <Button variant="ghost" size="small" onClick={() => onNotify(t("selectedChangeset.prototypeNotice"))}>
          {t("selectedChangeset.openDetails")} <ArrowRight size={14} />
        </Button>
      </div>
    </section>
  );
}
