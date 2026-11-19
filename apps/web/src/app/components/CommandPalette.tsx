import { useState } from "react";
import { ArrowRight, CircleDot, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { itemHref, navigationItems, type NavigationItem } from "../navigation";
import { useAppAccount } from "../account-context";
import { useNavigateTo } from "../useNavigateTo";
import { CURRENT_ORGANIZATION_HANDLE, organizationHandle } from "../../shared/routing";
import { Button, Input, Modal } from "../../shared/ui";

type Props = { open: boolean; onClose: () => void };

/** Maps navigation labels to translation keys */
const labelToNavKey = (label: string): string => {
  const keyMap: Record<string, string> = {
    "Overview": "routes.overview",
    "Projects": "routes.projects",
    "Repositories": "routes.repositories",
    "Changesets": "routes.changesets",
    "Workspaces": "routes.workspaces",
    "Trails": "routes.trails",
    "Stacks": "routes.stacks",
    "Review": "routes.review",
    "Eval": "routes.eval",
    "Self-healing": "routes.selfHealing",
    "Memory": "routes.memory",
    "CI / CD": "routes.cicd",
    "UI Components": "routes.uiComponents",
    "Organization": "routes.organization",
    "Security": "routes.security",
    "Governance": "routes.governance",
    "Cost & Usage": "routes.usage",
    "Settings": "routes.settings",
  };
  return keyMap[label] || label;
};

export function CommandPalette({ open, onClose }: Props) {
  const { t } = useTranslation("navigation");
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
    <Modal open={open} title={t("commandPalette.title")} onCancel={close} closeOnBackdrop width={440}>
      <div className="command-palette">
        <div className="command-palette__search">
          <Search size={16} aria-hidden="true" />
          <Input
            aria-label={t("commandPalette.searchAriaLabel")}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("commandPalette.placeholder")}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-palette__results" role="list" aria-label={t("commandPalette.searchAriaLabel")}>
          {pages.length ? pages.map((page) => (
            <Button
              key={page.label}
              variant="ghost"
              className="command-palette__item"
              onClick={() => navigate(page)}
            >
              <CircleDot size={15} aria-hidden="true" />
              <span>{t(labelToNavKey(page.label))}</span>
              <ArrowRight size={14} aria-hidden="true" />
            </Button>
          )) : <p className="command-palette__empty" role="status">{t("commandPalette.noResults")}</p>}
        </div>
      </div>
    </Modal>
  );
}
