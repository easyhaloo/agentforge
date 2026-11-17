import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";

type Input = { title: string; repository: string };
type Props = { open: boolean; onClose: () => void; onCreate: (input: Input) => Promise<boolean> };

export function CreateChangesetDialog({ open, onClose, onCreate }: Props) {
  const [title, setTitle] = useState("");
  const [repository, setRepository] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = { title: title.trim(), repository: repository.trim() };
    if (!input.title) { setError("A title is required."); return; }
    if (!/^[^/\s]+\/[^/\s]+$/.test(input.repository)) { setError("Repository must use owner/name format."); return; }
    setSubmitting(true);
    setError("");
    try {
      if (await onCreate(input)) {
        setTitle("");
        setRepository("");
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <div className="modal">
      <div className="modal-head"><div><span className="eyebrow">PERSISTENT RESOURCE</span><h2>Create changeset</h2></div><button className="icon-button" onClick={onClose} disabled={submitting}><X size={18}/></button></div>
      <form onSubmit={submit}>
        <label>Title<input required value={title} onChange={event => setTitle(event.target.value)} placeholder="Describe the proposed change"/></label>
        <label>Repository<input required value={repository} onChange={event => setRepository(event.target.value)} placeholder="owner/repository"/></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={submitting}>Cancel</button><button className="button primary" type="submit" disabled={submitting}><Plus size={15}/>{submitting ? "Creating…" : "Create changeset"}</button></div>
      </form>
      <p className="mock-note">This creates persistent Changeset metadata in the Go API. Git revision validation, evaluation, evidence, review and merge require their respective backend integrations.</p>
    </div>
  </div>;
}
