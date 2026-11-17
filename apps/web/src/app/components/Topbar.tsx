import { Bell, Search } from "lucide-react";
import { Button } from "../../shared/ui";

type Props = { label: string; onSearch: () => void; onNotify: (message: string) => void };

export function Topbar({ label, onSearch, onNotify }: Props) {
  return (
    <header className="topbar">
      <div className="breadcrumbs">Workspace <span>/</span> <b>{label}</b></div>
      <div className="top-actions">
        <Button variant="ghost" className="searchbox" onClick={onSearch} aria-label="Search anything (Command K)">
          <Search size={15} /> Search anything... <kbd>⌘ K</kbd>
        </Button>
        <Button variant="ghost" className="icon-button" onClick={() => onNotify("You're all caught up.")} aria-label="Notifications">
          <Bell size={17} /><i />
        </Button>
        <div className="avatar small">H</div>
      </div>
    </header>
  );
}
