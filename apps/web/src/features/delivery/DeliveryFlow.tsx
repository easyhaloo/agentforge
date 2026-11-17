import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { ApiError } from "../../shared/api";
import { listChangesets, type StoredChangeset } from "./api";

type Props = { page: string; onNotify: (message: string) => void };

function statusOf(item: StoredChangeset): string {
  const change = item.changeset;
  if (change.merge) return "Merged";
  const current = change.revisions.at(-1);
  if (!current) return "Draft";
  if (change.reviews.some((review) => review.revision_id === current.id && review.status === "approved")) return "Approved";
  if (change.evidence.some((evidence) => evidence.revision_id === current.id && evidence.status === "active")) return "Evidence ready";
  if (change.evaluations.some((evaluation) => evaluation.revision_id === current.id)) return "Evaluated";
  return "Revision created";
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Authentication is required. Sign in through the configured identity provider before loading delivery data.";
    if (error.status === 503) return "The API is not ready for authenticated delivery requests. Configure the backend identity provider and database first.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Unable to load changesets.";
}

export function DeliveryFlow({ page }: Props) {
  const [items, setItems] = useState<StoredChangeset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listChangesets({ limit: 50, offset: 0 });
      setItems(result.items);
      setSelectedId((current) => current && result.items.some((item) => item.changeset.id === current)
        ? current
        : result.items[0]?.changeset.id ?? null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => items.find((item) => item.changeset.id === selectedId) ?? null,
    [items, selectedId],
  );

  return <section className="delivery-api-workspace">
    <div className="delivery-api-toolbar">
      <div>
        <span className="eyebrow">PERSISTED DELIVERY DATA</span>
        <h2>{page === "Changesets" ? "Changesets" : page}</h2>
        <p>Records are loaded from the Go API and PostgreSQL. No browser demo state is used here.</p>
      </div>
      <button className="button secondary" onClick={() => void load()} disabled={loading}>
        <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
      </button>
    </div>

    {loading && <div className="api-state"><Activity size={18} /> Loading changesets from the API…</div>}
    {!loading && error && <div className="api-state api-state-error" role="alert">
      <AlertCircle size={18} />
      <div><b>Delivery data unavailable</b><p>{error}</p><button className="button secondary compact" onClick={() => void load()}>Retry</button></div>
    </div>}
    {!loading && !error && items.length === 0 && <div className="api-state api-state-empty">
      <ShieldAlert size={20} />
      <div><b>No persisted changesets yet</b><p>Create a changeset to begin. Revision, evaluation, evidence and review actions remain gated until their real backend adapters are configured.</p></div>
    </div>}

    {!loading && !error && items.length > 0 && <div className="delivery-api-grid">
      <div className="card delivery-api-list">
        <div className="flow-section-head"><div><span className="eyebrow">WORKSPACE</span><h3>{items.length} changesets</h3></div></div>
        {items.map((item) => <button key={item.changeset.id} className={"delivery-api-list-item " + (selectedId === item.changeset.id ? "selected" : "")} onClick={() => setSelectedId(item.changeset.id)}>
          <span><b>{item.changeset.title}</b><small>{item.changeset.id} · {item.changeset.repository}</small></span>
          <span className="resource-status">{statusOf(item)}</span>
        </button>)}
      </div>
      {selected && <div className="card delivery-api-detail">
        <div className="flow-section-head">
          <div><span className="eyebrow">CHANGESET DETAIL</span><h3>{selected.changeset.title}</h3><p>{selected.changeset.id} · {selected.changeset.repository}</p></div>
          <span className="resource-status">{statusOf(selected)}</span>
        </div>
        <div className="delivery-api-facts">
          <div><span>Created by</span><b>{selected.changeset.created_by}</b></div>
          <div><span>Version</span><b>{selected.version}</b></div>
          <div><span>Revisions</span><b>{selected.changeset.revisions.length}</b></div>
          <div><span>Evaluations</span><b>{selected.changeset.evaluations.length}</b></div>
          <div><span>Evidence</span><b>{selected.changeset.evidence.length}</b></div>
          <div><span>Reviews</span><b>{selected.changeset.reviews.length}</b></div>
        </div>
        <div className="flow-subsection">
          <div className="flow-subhead"><h4>Revision history</h4><span>{selected.changeset.revisions.length}</span></div>
          {selected.changeset.revisions.length === 0 ? <p className="api-muted">No revision has been linked to a verified Git commit.</p> : selected.changeset.revisions.map((revision) => <div className="evidence-row" key={revision.id}>
            <div><b>{revision.id}</b><small>{revision.ref} · {new Date(revision.created_at).toLocaleString()}</small></div>
          </div>)}
        </div>
        <div className="flow-subsection">
          <div className="flow-subhead"><h4>Audit trail</h4><span>{selected.changeset.audit.length} events</span></div>
          {selected.changeset.audit.length === 0 ? <p className="api-muted">No audit events recorded.</p> : selected.changeset.audit.slice().reverse().map((event) => <div className="delivery-api-audit" key={event.sequence}>
            <span className="timeline-dot" /><div><b>{event.operation}</b><small>{event.actor} · {event.outcome} · {new Date(event.at).toLocaleString()}</small></div>
          </div>)}
        </div>
        <div className="api-capability-note"><ShieldAlert size={16} /><p>Git revision validation, evaluation workers, evidence provenance, review authorization and merge execution are not configured yet. The API rejects these operations rather than simulating success.</p></div>
      </div>}
    </div>}
  </section>;
}
