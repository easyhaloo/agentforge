import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Button,
  Checkbox,
  DataTable,
  DatePicker,
  Input,
  Modal,
  RadioGroup,
  Select,
  Switch,
  TextArea,
} from "./index";
import { Alert, Empty, Loading, Skeleton, NotificationProvider } from "./feedback";

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

  it("renders select options and disabled choices", () => {
    const html = renderToStaticMarkup(<Select aria-label="Environment" options={[{ label: "Development", value: "dev" }, { label: "Production", value: "prod", disabled: true }]} />);
    expect(html).toContain('value="dev"');
    expect(html).toContain('value="prod" disabled=""');
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

  it("renders data tables with stable row keys and column headers", () => {
    const html = renderToStaticMarkup(<DataTable columns={[{ key: "name", title: "Name" }]} data={[{ id: "one", name: "Example" }]} rowKey="id" />);
    expect(html).toContain("<th");
    expect(html).toContain("Example");
  });

  it("provides an accessible notification viewport", () => {
    const html = renderToStaticMarkup(<NotificationProvider><div>Application</div></NotificationProvider>);
    expect(html).toContain('aria-label="Notifications"');
    expect(html).toContain("Application");
  });
});
