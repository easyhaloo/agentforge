import { ArrowRight, GitPullRequest } from "lucide-react";
import { Button } from "../../../shared/ui";

type Props = {
  changesetId: string;
  onNotify: (message: string) => void;
};

export function SelectedChangesetPanel({ changesetId, onNotify }: Props) {
  return (
    <section className="detail-strip card">
      <div className="detail-icon"><GitPullRequest size={18} /></div>
      <div>
        <b>{changesetId} <span className="detail-title">Selected changeset</span></b>
        <p>Revision r3 · Base main · 12 files changed · 42 checks</p>
      </div>
      <div className="detail-right">
        <span className="status success"><i />Evidence current</span>
        <Button variant="ghost" size="small" onClick={() => onNotify("Changeset detail view is a prototype interaction.")}>
          Open details <ArrowRight size={14} />
        </Button>
      </div>
    </section>
  );
}
