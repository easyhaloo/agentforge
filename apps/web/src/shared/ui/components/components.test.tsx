import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
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
