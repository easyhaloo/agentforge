import { Bell, Search } from "lucide-react";

type Props = { active: string; onSearch: () => void; onNotify: (message: string) => void };

export function Topbar({ active, onSearch, onNotify }: Props) {
  return <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <b>{active}</b></div><div className="top-actions"><button className="searchbox" onClick={onSearch}><Search size={15}/> Search anything... <kbd>⌘ K</kbd></button><button className="icon-button" onClick={()=>onNotify("You're all caught up.")}><Bell size={17}/><i/></button><div className="avatar small">H</div></div></header>;
}
