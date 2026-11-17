import { Workflow } from "lucide-react";

export function DeliveryFlowBanner() {
  return <div className="flow-banner">
    <div className="flow-banner-icon"><Workflow size={19} /></div>
    <div><b>Verified delivery workflow</b><p>One revision is traced through evaluation, human review and delivery. Evidence is always revision-scoped.</p></div>
    <span className="demo-pill">INTERACTIVE DEMO</span>
  </div>;
}
