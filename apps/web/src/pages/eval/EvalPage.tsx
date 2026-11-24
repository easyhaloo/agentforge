import type { OrganizationSummary } from "../../shared/api/identity";
import { ChangesetQueue } from "../changesets/ui/ChangesetQueue";

export function EvalPage({ organization }: { organization: OrganizationSummary; onNotify: (message: string) => void }) {
  return <ChangesetQueue organization={organization} kind="eval" />;
}
