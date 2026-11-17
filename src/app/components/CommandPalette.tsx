import { useState } from "react";
import { ArrowRight, CircleDot, Search } from "lucide-react";
import { groups } from "../navigation";

type Props = { open: boolean; onClose: () => void; onNavigate: (page: string) => void };

export function CommandPalette({ open, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState("");
  if (!open) return null;
  const pages = groups.flatMap(group=>group.items.map(([name])=>String(name))).filter(name=>name.toLowerCase().includes(query.toLowerCase()));
  const navigate = (page: string) => { onNavigate(page); setQuery(""); onClose(); };
  return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><div className="command-modal"><div className="command-input"><Search size={17}/><input autoFocus placeholder="Jump to a page..." value={query} onChange={event=>setQuery(event.target.value)}/><kbd>ESC</kbd></div>{pages.map(page=><button key={page} onClick={()=>navigate(page)}><CircleDot size={15}/>{page}<ArrowRight size={14}/></button>)}</div></div>;
}
