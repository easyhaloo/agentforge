import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { Button, Drawer, Modal, Popover, Tabs } from "../src/shared/ui";
import { CommandPalette } from "../src/app/components/CommandPalette";
import "../src/styles/index.css";
import "../src/shared/ui/theme/theme.css";
import "../src/shared/ui/components/components.css";

function NavigationProbe() {
  const { pathname } = useLocation();
  return <p data-testid="navigation-result">Location: {pathname}</p>;
}

function SharedUIHarness() {
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [tab, setTab] = useState("overview");

  return (
    <main style={{ padding: 24, display: "grid", gap: 16, maxWidth: 720 }}>
      <h1>Shared UI browser test harness</h1>
      <Button onClick={() => setModalOpen(true)}>Open modal</Button>
      <Button onClick={() => setDrawerOpen(true)}>Open drawer</Button>
      <Button onClick={() => setCommandOpen(true)}>Open command palette</Button>
      <Modal open={modalOpen} title="Browser test modal" onCancel={() => setModalOpen(false)}>
        <p>Modal content for keyboard and backdrop tests.</p>
        <Button onClick={() => setModalOpen(false)}>Modal action</Button>
      </Modal>
      <Drawer open={drawerOpen} title="Browser test drawer" onClose={() => setDrawerOpen(false)}>
        <p>Drawer content for keyboard tests.</p>
        <Button onClick={() => setDrawerOpen(false)}>Drawer action</Button>
      </Drawer>
      <Popover trigger="Open popover" ariaLabel="Browser test popover">
        <Button>Popover action</Button>
      </Popover>
      <Tabs
        id="browser-tabs"
        ariaLabel="Browser test tabs"
        value={tab}
        onChange={setTab}
        items={[
          { key: "overview", label: "Overview" },
          { key: "activity", label: "Activity" },
          { key: "settings", label: "Settings" },
        ]}
      />
      <p data-testid="active-tab">Active tab: {tab}</p>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
      <NavigationProbe />
      <button type="button" tabIndex={-1} data-testid="outside-focus-target">Outside focus target</button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/harness"]}>
    <SharedUIHarness />
  </MemoryRouter>,
);
