import { renderToStaticMarkup } from "react-dom/server";
import { act, render, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../../locales";
import {
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  DatePicker,
  Input,
  Modal,
  Popover,
  Select,
  Tabs,
  getNextEnabledTabIndex,
  getFocusTrapTargetIndex,
} from "./index";
import { Checkbox, RadioGroup, Switch, TextArea } from "./form-controls";
import { Alert, Empty, Loading, Skeleton, NotificationProvider } from "./feedback";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});

describe("shared UI primitives", () => {
  it("renders buttons with a stable type, variant and loading contract", () => {
    const html = renderToStaticMarkup(<Button variant="primary" loading>Save</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain("af-button--primary");
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
  });

  it("keeps inactive buttons focusable, annotated and clickable", async () => {
    const onInactiveClick = vi.fn();
    const html = renderToStaticMarkup(
      <Button inactive inactiveReason="Only owners can do this" onInactiveClick={onInactiveClick}>Pause</Button>,
    );
    expect(html).toContain("af-button--inactive");
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("Only owners can do this");
    const screen = render(<Button inactive inactiveReason="Only owners" onInactiveClick={onInactiveClick}>Pause</Button>);
    await act(async () => {
      screen.getByRole("button").click();
    });
    expect(onInactiveClick).toHaveBeenCalledTimes(1);
  });

  it("still lets regular buttons receive native clicks", async () => {
    const onClick = vi.fn();
    const screen = render(<Button onClick={onClick}>Save</Button>);
    await act(async () => {
      screen.getByRole("button").click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders labelled input validation and hint relationships", () => {
    const error = renderToStaticMarkup(<Input label="Email" name="email" error="Required" />);
    expect(error).toContain('for="email"');
    expect(error).toContain('aria-invalid="true"');
    expect(error).toContain('id="email-error"');
    const hint = renderToStaticMarkup(<Input label="Name" name="name" hint="Shown publicly" />);
    expect(hint).toContain('id="name-hint"');
    expect(hint).toContain("Shown publicly");
  });

  it("renders custom select with proper accessibility attributes", () => {
    const html = renderToStaticMarkup(<Select aria-label="Environment" options={[{ label: "Development", value: "dev" }, { label: "Production", value: "prod", disabled: true }]} />);
    expect(html).toContain('af-select-trigger');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('type="button"');
  });

  it("preserves native form semantics for date, textarea and choice controls", () => {
    expect(renderToStaticMarkup(<DatePicker aria-label="Start date" name="start" />)).toContain('type="date"');
    expect(renderToStaticMarkup(<TextArea label="Notes" name="notes" required />)).toContain("af-textarea");
    expect(renderToStaticMarkup(<Checkbox label="Accept terms" checked readOnly />)).toContain('type="checkbox"');
    expect(renderToStaticMarkup(<RadioGroup name="role" options={[{ label: "Member", value: "member" }]} />)).toContain('type="radio"');
    expect(renderToStaticMarkup(<Switch label="Enabled" checked readOnly />)).toContain('role="switch"');
  });

  it("renders modal semantics and accessible feedback states", () => {
    const modal = renderToStaticMarkup(<Modal open title="Confirm action" onCancel={() => undefined}>Proceed?</Modal>);
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain("Confirm action");
    expect(renderToStaticMarkup(<Alert status="error">Request failed</Alert>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Empty title="No records" />)).toContain("No records");
    expect(renderToStaticMarkup(<Loading label="Loading records" />)).toContain('role="status"');
    expect(renderToStaticMarkup(<Skeleton lines={2} />)).toContain("af-skeleton");
  });

  it("renders drawer and confirmation dialog accessibility contracts", () => {
    const drawer = renderToStaticMarkup(<Drawer open title="Resource details" onClose={() => undefined}>Details</Drawer>);
    expect(drawer).toContain('role="dialog"');
    expect(drawer).toContain('aria-labelledby="');
    expect(drawer).toContain('<h2 id="');
    expect(drawer).toContain(">Resource details</h2>");
    const confirmation = renderToStaticMarkup(<ConfirmDialog open danger description="Remove this member?" onCancel={() => undefined} onConfirm={() => undefined} />);
    expect(confirmation).toContain("Are you sure?");
    expect(confirmation).toContain("Remove this member?");
    expect(confirmation).toContain("af-button--danger");
  });

  it("renders confirm dialog banners and dismiss locks", () => {
    const banner = renderToStaticMarkup(
      <Alert status="error" dismissible={false}>This cannot be undone</Alert>,
    );
    expect(banner).toContain("This cannot be undone");
    expect(banner).not.toContain("aria-label=");
    const dialog = renderToStaticMarkup(
      <ConfirmDialog
        open
        danger
        focusCancel
        lockDismiss
        banner={<Alert status="error" dismissible={false}>Impact</Alert>}
        description="Delete this organization?"
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(dialog).toContain("Impact");
    expect(dialog).toContain('aria-modal="true"');
  });

  it("hides the close button on non-dismissible alerts", () => {
    const locked = renderToStaticMarkup(<Alert status="warning" closable dismissible={false}>Locked state</Alert>);
    expect(locked).not.toContain("af-alert__close");
    const unlocked = renderToStaticMarkup(<Alert status="warning" closable>Closable state</Alert>);
    expect(unlocked).toContain("af-alert__close");
  });

  it("exposes accessible popover trigger relationships", () => {
    const html = renderToStaticMarkup(<Popover trigger="More" ariaLabel="More actions">Menu content</Popover>);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("More");
  });

  it("renders accessible shared tabs with roving tab stops", () => {
    const html = renderToStaticMarkup(
      <Tabs
        id="settings"
        value="members"
        onChange={() => undefined}
        ariaLabel="Settings"
        items={[{ key: "members", label: "Members" }, { key: "invitations", label: "Invitations" }]}
      />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Settings"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls="settings-panel"');
    expect(html).toContain('tabindex="-1"');
  });

  it("moves tab focus with wraparound while skipping disabled tabs", () => {
    const items = [{ key: "members", label: "Members" }, { key: "disabled", label: "Disabled", disabled: true }, { key: "audit", label: "Audit" }];
    expect(getNextEnabledTabIndex(items, 0, "ArrowRight")).toBe(2);
    expect(getNextEnabledTabIndex(items, 2, "ArrowRight")).toBe(0);
    expect(getNextEnabledTabIndex(items, 0, "ArrowLeft")).toBe(2);
    expect(getNextEnabledTabIndex(items, 2, "Home")).toBe(0);
    expect(getNextEnabledTabIndex(items, 0, "End")).toBe(2);
  });


  it("keeps modal and drawer keyboard focus inside when focus escapes", () => {
    expect(getFocusTrapTargetIndex(3, 0, true, true)).toBe(2);
    expect(getFocusTrapTargetIndex(3, 2, false, true)).toBe(0);
    expect(getFocusTrapTargetIndex(3, -1, false, false)).toBe(0);
    expect(getFocusTrapTargetIndex(3, -1, true, false)).toBe(2);
    expect(getFocusTrapTargetIndex(3, 1, false, true)).toBeNull();
    expect(getFocusTrapTargetIndex(0, -1, false, false)).toBeNull();
  });

  it("renders data tables with stable row keys and column headers", () => {
    const html = renderToStaticMarkup(<DataTable columns={[{ key: "name", title: "Name", render: (_, row) => <strong>{row.name}</strong> }]} data={[{ id: "one", name: "Example" }]} rowKey="id" showColumnVisibility={false} />);
    expect(html).toContain("<th");
    expect(html).toContain("<strong>Example</strong>");
  });

  it("provides an accessible notification viewport", () => {
    const html = renderToStaticMarkup(<NotificationProvider><div>Application</div></NotificationProvider>);
    expect(html).toContain('aria-label="Notifications"');
    expect(html).toContain("Application");
  });
});

describe("Drawer animations", () => {
  it("applies visible class when drawer opens", async () => {
    const { container, rerender } = render(
      <Drawer open={false} title="Test Drawer" onClose={() => undefined}>
        Content
      </Drawer>
    );

    // Initially closed, drawer should not be in DOM
    expect(container.querySelector('.af-drawer')).toBeNull();

    // Open the drawer
    rerender(
      <Drawer open={true} title="Test Drawer" onClose={() => undefined}>
        Content
      </Drawer>
    );

    // After opening, drawer should be mounted with visible class
    await waitFor(() => {
      const drawer = container.querySelector('.af-drawer');
      expect(drawer).not.toBeNull();
      expect(drawer?.classList.contains('af-drawer--visible')).toBe(true);
    });
  });

  it("removes drawer from DOM after exit animation completes", async () => {
    const { container, rerender } = render(
      <Drawer open={true} title="Test Drawer" onClose={() => undefined}>
        Content
      </Drawer>
    );

    // Wait for drawer to be visible
    await waitFor(() => {
      expect(container.querySelector('.af-drawer')).not.toBeNull();
    });

    // Close the drawer
    rerender(
      <Drawer open={false} title="Test Drawer" onClose={() => undefined}>
        Content
      </Drawer>
    );

    // Drawer should still be in DOM but without visible class
    await waitFor(() => {
      expect(container.querySelector('.af-drawer')).not.toBeNull();
      expect(container.querySelector('.af-drawer--visible')).toBeNull();
    });

    // After animation duration, drawer should be unmounted
    await waitFor(() => {
      expect(container.querySelector('.af-drawer')).toBeNull();
    }, { timeout: 1000 });
  });

  it("applies visible class to backdrop when drawer opens", async () => {
    const { container } = render(
      <Drawer open={true} title="Test Drawer" onClose={() => undefined}>
        Content
      </Drawer>
    );

    await waitFor(() => {
      const backdrop = container.querySelector('.af-drawer-backdrop');
      expect(backdrop).not.toBeNull();
      expect(backdrop?.classList.contains('af-drawer-backdrop--visible')).toBe(true);
    });
  });
});
