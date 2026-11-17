import { useState } from "react";
import { ArrowRight, CircleDot, Search } from "lucide-react";
import { navigationItems } from "../navigation";
import { Button, Input, Modal } from "../../shared/ui";

type Props = { open: boolean; onClose: () => void; onNavigate: (page: string) => void };

export function CommandPalette({ open, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const pages = navigationItems
    .map((item) => item.label)
    .filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()));

  const navigate = (page: string) => {
    onNavigate(page);
    setQuery("");
    onClose();
  };

  const close = () => {
    setQuery("");
    onClose();
  };

  return (
    <Modal open={open} title="Jump to a page" onCancel={close} closeOnBackdrop width={440}>
      <div className="command-palette">
        <div className="command-palette__search">
          <Search size={16} aria-hidden="true" />
          <Input
            aria-label="Search pages"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a page..."
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-palette__results" role="list" aria-label="Matching pages">
          {pages.length ? pages.map((page) => (
            <Button
              key={page}
              variant="ghost"
              className="command-palette__item"
              onClick={() => navigate(page)}
            >
              <CircleDot size={15} aria-hidden="true" />
              <span>{page}</span>
              <ArrowRight size={14} aria-hidden="true" />
            </Button>
          )) : <p className="command-palette__empty" role="status">No matching pages</p>}
        </div>
      </div>
    </Modal>
  );
}
