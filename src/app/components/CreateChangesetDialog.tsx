import { useState, type FormEvent } from "react";
import { Plus, Sparkles, X } from "lucide-react";

type Props = { open: boolean; onClose: () => void; onCreate: (title: string) => void };

export function CreateChangesetDialog({ open, onClose, onCreate }: Props) {
  const [title, setTitle] = useState("");
  if (!open) return null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    onCreate(value);
    setTitle("");
  };
  return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><div className="modal"><div className="modal-head"><div><span className="eyebrow">NEW RESOURCE</span><h2>Create changeset</h2></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div><form onSubmit={submit}><label>Title<input required value={title} onChange={event=>setTitle(event.target.value)} placeholder="Describe the change or goal"/></label><label>Project<select><option>agentforge-core</option><option>web-platform</option><option>event-service</option></select></label><label>Description<textarea placeholder="What should this change accomplish?"/></label><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" type="submit"><Plus size={15}/> Create resource</button></div></form><p className="mock-note"><Sparkles size={13}/> This creates a local demo record only. No Git or backend operation is performed.</p></div></div>;
}
