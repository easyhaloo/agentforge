import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { organizationLifecycleAPI, type LifecycleStatus } from "../../../shared/api/organizationLifecycle";

/** Minimal shape the settings pages need; supplied by the OrganizationGate outlet. */
type OrganizationLike = { id: string; slug: string; name: string; role: string };

/**
 * One lifecycle fetch shared by the settings pages under /orgs/:org/settings/*.
 * The lifecycle state arrives with every mutation response, so pages call
 * `apply(state)` after an action instead of re-fetching.
 */
export function useOrganizationLifecycle() {
  const { organization } = useOutletContext<{ organization: OrganizationLike }>();
  const [status, setStatus] = useState<LifecycleStatus>("active");
  const [suspendedAt, setSuspendedAt] = useState<string | null>(null);
  const [suspendedReason, setSuspendedReason] = useState("");
  const [deletionScheduledAt, setDeletionScheduledAt] = useState<string | null>(null);
  const [identityReady, setIdentityReady] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    // identity-health is owner-only and best-effort; anything else keeps the
    // banner hidden rather than showing a wrong warning.
    void organizationLifecycleAPI.identityHealth(organization.id).then(
      (health) => setIdentityReady(health.ready),
      () => setIdentityReady(null),
    );
  }, [organization.id]);

  useEffect(() => { refresh(); }, [refresh]);

  /** Apply a mutation response so the shell and pages agree on one state. */
  const apply = useCallback((state: { status: LifecycleStatus; suspended_at?: string | null; suspended_reason?: string; deletion_scheduled_at?: string | null }) => {
    setStatus(state.status);
    setSuspendedAt(state.suspended_at ?? null);
    setSuspendedReason(state.suspended_reason ?? "");
    setDeletionScheduledAt(state.deletion_scheduled_at ?? null);
  }, []);

  return {
    organization,
    status, suspendedAt, suspendedReason, deletionScheduledAt, identityReady,
    apply, refresh,
  };
}

export type OrganizationLifecycleState = ReturnType<typeof useOrganizationLifecycle>;
