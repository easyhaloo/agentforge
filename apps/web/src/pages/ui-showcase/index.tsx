import { useState } from "react";
import {
  AsyncSelect,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  DatePicker,
  DateRangePicker,
  Drawer,
  Form,
  FormItem,
  Input,
  Alert,
  Empty,
  Loading,
  NotificationProvider,
  Skeleton,
  useNotification,
  Modal,
  NumberInput,
  PasswordInput,
  Popover,
  RadioGroup,
  SearchInput,
  Select,
  Switch,
  TextArea,
  type DataTableColumn,
  type SelectOption,
} from "@/shared/ui";

type DemoRow = { id: number; name: string; status: string; updated: string };
const initialRows: DemoRow[] = [
  { id: 1001, name: "API Gateway", status: "Healthy", updated: "2026-11-17" },
  { id: 1002, name: "Worker Runtime", status: "Deploying", updated: "2026-11-16" },
  { id: 1003, name: "Policy Engine", status: "Healthy", updated: "2026-11-15" },
];
const environmentOptions: SelectOption[] = [
  { label: "Development", value: "development" },
  { label: "Staging", value: "staging" },
  { label: "Production", value: "production" },
];
async function loadTeamOptions(keyword: string, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, 280);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
  const all = ["Platform Engineering", "Runtime Team", "Security Operations", "Developer Experience"];
  return all.filter((name) => name.toLowerCase().includes(keyword.toLowerCase())).map((name) => ({ label: name, value: name.toLowerCase().replaceAll(" ", "-") }));
}

export function UIShowcasePage() {
  return <NotificationProvider><UIShowcaseContent /></NotificationProvider>;
}

function UIShowcaseContent() {
  const { notify } = useNotification();
  const [inputValue, setInputValue] = useState("agentforge-core");
  const [environment, setEnvironment] = useState("staging");
  const [date, setDate] = useState("2026-11-17");
  const [dateRange, setDateRange] = useState({ start: "2026-11-01", end: "2026-11-17" });
  const [search, setSearch] = useState("");
  const [searchResult, setSearchResult] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [team, setTeam] = useState("");
  const [password, setPassword] = useState("agentforge-secret");
  const [replicas, setReplicas] = useState(3);
  const [notifications, setNotifications] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [accessLevel, setAccessLevel] = useState("maintainer");
  const [selectedRows, setSelectedRows] = useState<Array<string | number>>([]);
  const [rows] = useState(initialRows);
  const [sortMessage, setSortMessage] = useState("No sort applied");

  const columns: DataTableColumn<DemoRow>[] = [
    { key: "id", title: "ID", width: 90, sortable: true },
    { key: "name", title: "SERVICE", sortable: true },
    { key: "status", title: "STATUS", render: (value) => <span className={value === "Healthy" ? "af-showcase-status is-good" : "af-showcase-status is-pending"}>{String(value)}</span> },
    { key: "updated", title: "UPDATED", sortable: true },
  ];

  return (
    <div className="af-showcase">
      <section className="af-showcase-intro">
        <div><span className="af-showcase-kicker">DESIGN SYSTEM / FOUNDATIONS</span><h2>Shared UI components</h2><p>Reusable controls, interaction patterns and data primitives used across AgentForge.</p></div>
        <span className="af-showcase-version">UI FOUNDATION · v0.2</span>
      </section>

      <section className="af-showcase-section">
        <div className="af-showcase-section__heading"><div><h3>Actions</h3><p>Consistent button hierarchy and feedback states.</p></div></div>
        <div className="af-showcase-row"><Button variant="primary">Primary action</Button><Button>Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button loading>Saving</Button><Button disabled>Disabled</Button></div>
      </section>

      <section className="af-showcase-section">
        <div className="af-showcase-section__heading"><div><h3>Form controls</h3><p>Labels, validation, native date values and remote options.</p></div></div>
        <div className="af-showcase-grid">
          <Form onSubmit={(event) => event.preventDefault()}>
            <FormItem><Input label="Workspace name" value={inputValue} onChange={(event) => setInputValue(event.target.value)} hint="Unique name within your organization" /></FormItem>
            <FormItem><Input label="Invalid example" value="bad value" readOnly error="Only letters, numbers and hyphens are allowed" /></FormItem>
            <FormItem><Select label="Environment" value={environment} onChange={(event) => setEnvironment(event.target.value)} options={environmentOptions} /></FormItem>
            <FormItem><DatePicker label="Release date" value={date} onChange={(event) => setDate(event.target.value)} /></FormItem>
            <FormItem><DateRangePicker start={dateRange.start} end={dateRange.end} onChange={setDateRange} /></FormItem>
            <FormItem><AsyncSelect value={team} onChange={setTeam} loadOptions={loadTeamOptions} placeholder="Find a team..." /></FormItem>
          </Form>
          <div className="af-showcase-card"><h4>Search</h4><p>Debounced search with immediate Enter submission.</p><SearchInput value={search} onChange={setSearch} onSearch={setSearchResult} placeholder="Search projects..." /><div className="af-showcase-result">Last submitted query: <b>{searchResult || "—"}</b></div></div>
        </div>
      </section>

      <section className="af-showcase-section">
        <div className="af-showcase-section__heading"><div><h3>Extended form controls</h3><p>Accessible password, numeric, multiline, choice and toggle inputs.</p></div></div>
        <div className="af-showcase-grid">
          <Form>
            <FormItem><TextArea label="Description" rows={3} defaultValue="A reusable workspace for agent-driven development." hint="Keep descriptions concise and actionable." /></FormItem>
            <FormItem><PasswordInput label="API token" value={password} onChange={(event) => setPassword(event.target.value)} hint="Visibility can be toggled without changing the value." autoComplete="new-password" /></FormItem>
            <FormItem><NumberInput label="Worker replicas" min={1} max={20} step={1} value={replicas} onChange={(event) => setReplicas(Number(event.target.value))} /></FormItem>
            <FormItem><Checkbox label="I accept the workspace policy" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /></FormItem>
          </Form>
          <div className="af-showcase-card">
            <h4>Choice and preferences</h4>
            <p>Controlled radio group and accessible switch.</p>
            <RadioGroup label="Default access level" name="showcase-access" direction="vertical" value={accessLevel} onChange={setAccessLevel} options={[{ label: "Viewer", value: "viewer" }, { label: "Maintainer", value: "maintainer" }, { label: "Administrator", value: "admin" }]} />
            <div className="af-showcase-result"><b>{accessLevel}</b> access selected</div>
            <Switch label="Release notifications" description="Receive updates when a release changes state." checked={notifications} onChange={(event) => setNotifications(event.target.checked)} />
            <div className="af-showcase-result">Notifications: <b>{notifications ? "Enabled" : "Disabled"}</b> · Replicas: <b>{replicas || 0}</b></div>
          </div>
        </div>
      </section>

      <section className="af-showcase-section">
        <div className="af-showcase-section__heading"><div><h3>Overlays and contextual UI</h3><p>Dialog, side panel, confirmation and anchored content.</p></div></div>
        <div className="af-showcase-row">
          <Button variant="primary" onClick={() => setModalOpen(true)}>Open modal</Button>
          <Button onClick={() => setDrawerOpen(true)}>Open drawer</Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>Confirm destructive action</Button>
          <Popover trigger="Show contextual info"><div><b>Popover content</b><p>Use for short contextual details and lightweight actions.</p></div></Popover>
        </div>
      </section>


      <section className="af-showcase-section">
        <div className="af-showcase-section__heading"><div><h3>Feedback and async states</h3><p>Inline status, transient notifications, empty states, skeletons and loading indicators.</p></div></div>
        <div className="af-showcase-grid">
          <div className="af-showcase-card">
            <h4>Inline alerts</h4>
            <div style={{ display: "grid", gap: 9 }}>
              <Alert status="info" title="Information">A background task has been queued.</Alert>
              <Alert status="success" title="Deployment complete">All checks passed successfully.</Alert>
              <Alert status="warning" title="Rate limit approaching">Review usage before starting another run.</Alert>
              <Alert status="error" title="Action required" closable>One integration needs attention.</Alert>
            </div>
          </div>
          <div className="af-showcase-card">
            <h4>Notifications</h4>
            <p>Use the global provider for short-lived operation feedback.</p>
            <div className="af-showcase-row">
              <Button onClick={() => notify({ status: "success", title: "Saved", message: "Workspace settings were updated." })}>Success</Button>
              <Button onClick={() => notify({ status: "warning", title: "Attention", message: "A worker is using most of its memory." })}>Warning</Button>
              <Button onClick={() => notify({ status: "error", title: "Request failed", message: "The service could not be reached." })}>Error</Button>
            </div>
          </div>
          <div className="af-showcase-card">
            <h4>Loading and skeleton</h4>
            <Loading label="Fetching service data" />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <Skeleton width={38} height={38} circle />
              <div style={{ flex: 1 }}><Skeleton width="65%" height={11} /><Skeleton width="42%" height={9} /></div>
            </div>
            <div style={{ marginTop: 12 }}><Skeleton lines={3} width="100%" height={9} /></div>
          </div>
          <div className="af-showcase-card">
            <h4>Empty state</h4>
            <Empty title="No deployments yet" description="Create your first deployment to see runtime health and release history." action={<Button size="small" variant="primary">Create deployment</Button>} />
          </div>
        </div>
      </section>

      <section className="af-showcase-section">
        <div className="af-showcase-section__heading"><div><h3>Data table</h3><p>Sortable columns, row selection and server-driven pagination callbacks.</p></div><span className="af-showcase-meta">{selectedRows.length} selected · {sortMessage}</span></div>
        <DataTable columns={columns} data={rows} rowKey="id" selectedRowKeys={selectedRows} onSelectionChange={setSelectedRows} onSort={(key, direction) => setSortMessage(direction ? key + " " + direction : "No sort applied")} pagination={{ page: 1, pageSize: 10, total: rows.length }} />
      </section>

      <Modal open={modalOpen} title="Create workspace" onCancel={() => setModalOpen(false)} onOk={async () => { await new Promise((resolve) => window.setTimeout(resolve, 350)); setModalOpen(false); }}>
        <Form><Input label="Workspace name" defaultValue="new-workspace" /><Select label="Environment" defaultValue="development" options={environmentOptions} /></Form>
      </Modal>
      <Drawer open={drawerOpen} title="Service details" onClose={() => setDrawerOpen(false)}>
        <h3>API Gateway</h3><p>Service metadata and operational details can live in a side panel without losing list context.</p><p className="af-showcase-status is-good">Healthy</p>
      </Drawer>
      <ConfirmDialog open={confirmOpen} title="Delete workspace?" description="This is a demonstration. No workspace will actually be deleted." confirmText="Delete" danger onCancel={() => setConfirmOpen(false)} onConfirm={() => setConfirmOpen(false)} />
    </div>
  );
}
