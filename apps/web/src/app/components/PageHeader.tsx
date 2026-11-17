import { Activity, Plus } from "lucide-react";
import { Button } from "../../shared/ui";
import { navigationItems } from "../navigation";

type Props = { active: string; onRefresh: () => void; onCreate?: () => void };

export function PageHeader({ active, onRefresh, onCreate }: Props) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">AGENTFORGE / {active.toUpperCase()}</div>
        <h1>{active}</h1>
        <p>{navigationItems.find((item) => item.label === active)?.description}</p>
      </div>
      <div className="heading-actions">
        <Button className="button secondary" onClick={onRefresh}>
          <Activity size={15} /> Refresh
        </Button>
        {onCreate && (
          <Button variant="primary" className="button primary" onClick={onCreate}>
            <Plus size={16} /> Create changeset
          </Button>
        )}
      </div>
    </div>
  );
}
