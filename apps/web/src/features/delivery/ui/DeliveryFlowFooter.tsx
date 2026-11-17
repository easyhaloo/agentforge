import { CheckCircle2 } from "lucide-react";

export function DeliveryFlowFooter() {
  return <div className="flow-bottom-note"><CheckCircle2 size={14} />
    Try the sequence: New revision → Run Eval → Approve revision → Merge & complete Trail. Then create another revision to see evidence become stale.
  </div>;
}
