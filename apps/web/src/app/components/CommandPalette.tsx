import { useState } from "react";
import { ArrowRight, CircleDot, Search } from "lucide-react";
import { itemHref, navigationItems, type NavigationItem } from "../navigation";
import { useAppAccount } from "../account-context";
import { useNavigateTo } from "../useNavigateTo";
import { CURRENT_ORGANIZATION_HANDLE, organizationHandle } from "../../shared/routing";
import { Button, Input, Modal } from "../../shared/ui";

type Props = { open: boolean; onClose: () => void };

export function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const navigateTo = useNavigateTo();
  const { selectedOrganization } = useAppAccount();
  const handle = selectedOrganization ? organizationHandle(selectedOrganization) : CURRENT_ORGANIZATION_HANDLE;
  const pages = navigationItems.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));

  const navigate = (item: NavigationItem) => {
    navigateTo(itemHref(item, handle));
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
              key={page.label}
              variant="ghost"
              className="command-palette__item"
              onClick={() => navigate(page)}
            >
              <CircleDot size={15} aria-hidden="true" />
              <span>{page.label}</span>
              <ArrowRight size={14} aria-hidden="true" />
            </Button>
          )) : <p className="command-palette__empty" role="status">No matching pages</p>}
        </div>
      </div>
    </Modal>
  );
}
