import { Activity, Plus } from "lucide-react";
import { descriptions } from "../navigation";

type Props = { active: string; onRefresh: () => void; onCreate?: () => void };

export function PageHeader({ active, onRefresh, onCreate }: Props) {
  return <div className="page-heading"><div><div className="eyebrow">AGENTFORGE / {active.toUpperCase()}</div><h1>{active}</h1><p>{descriptions[active]}</p></div><div className="heading-actions"><button className="button secondary" onClick={onRefresh}><Activity size={15}/> Refresh</button>{onCreate&&<button className="button primary" onClick={onCreate}><Plus size={16}/> Create changeset</button>}</div></div>;
}
