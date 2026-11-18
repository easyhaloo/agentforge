import { Activity, Plus } from "lucide-react";
import { Button } from "../../shared/ui";

type Props = { label: string; description?: string; onRefresh?: () => void; onCreate?: () => void };

export function PageHeader({ label, description, onRefresh, onCreate }: Props) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">AGENTFORGE / {label.toUpperCase()}</div>
        <h1>{label}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">
        {onRefresh && (
          <Button className="button secondary" onClick={onRefresh}>
            <Activity size={15} /> Refresh
          </Button>
        )}
        {onCreate && (
          <Button variant="primary" className="button primary" onClick={onCreate}>
            <Plus size={16} /> Create changeset
          </Button>
        )}
      </div>
    </div>
  );
}
