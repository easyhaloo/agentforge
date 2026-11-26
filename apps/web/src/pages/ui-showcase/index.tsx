import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActionList,
  ActionListGroup,
  ActionListItem,
  Alert,
  AsyncSelect,
  BorderBox,
  BorderBoxHeader,
  BorderBoxRow,
  BranchChip,
  Button,
  ButtonGroup,
  Checkbox,
  ConfirmDialog,
  CounterLabel,
  DataTable,
  DatePicker,
  DateRangePicker,
  DiffStat,
  Drawer,
  Empty,
  FileStatusBadge,
  FilterBar,
  Form,
  FormItem,
  Input,
  Label,
  Loading,
  Modal,
  NotificationProvider,
  NumberInput,
  PasswordInput,
  Popover,
  RadioGroup,
  SearchInput,
  Select,
  Skeleton,
  StateLabel,
  Subhead,
  Switch,
  TextArea,
  UnderlineNav,
  useNotification,
  type DataTableColumn,
  type SelectOption,
} from "@/shared/ui";

type PrimerTheme = "dark" | "dark-dimmed" | "light";

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
const primerThemes: readonly { id: PrimerTheme; label: string; description: string }[] = [
  { id: "dark", label: "Dark default", description: "Inset #010409 / Canvas #0d1117" },
  { id: "dark-dimmed", label: "Dark dimmed", description: "Inset #1c2128 / Canvas #22272e" },
  { id: "light", label: "Light default", description: "Inset #f6f8fa / Canvas #ffffff" },
];
const canvasSwatches = [
  { name: "Canvas Inset", token: "--bgColor-inset" },
  { name: "Canvas Default", token: "--bgColor-default" },
  { name: "Canvas Muted", token: "--bgColor-muted" },
  { name: "Underline Active", token: "--underlineNav-borderColor-active" },
] as const;

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
  const { t } = useTranslation();
  const { notify } = useNotification();
  const [previewTheme, setPreviewTheme] = useState<PrimerTheme>(() => {
    const current = document.documentElement.getAttribute("data-theme");
    return current === "light" || current === "dark-dimmed" ? current : "dark";
  });
  const [navTab, setNavTab] = useState("code");
  const [settingsSection, setSettingsSection] = useState("members");
  const [filterQuery, setFilterQuery] = useState("is:changeset is:open");
  const [submittedFilter, setSubmittedFilter] = useState("is:changeset is:open");
  const [diffViewMode, setDiffViewMode] = useState<"unified" | "split">("unified");

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

  useEffect(() => {
    const previousTheme = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", previewTheme);
    return () => {
      if (previousTheme === null) {
        document.documentElement.removeAttribute("data-theme");
      } else {
        document.documentElement.setAttribute("data-theme", previousTheme);
      }
    };
  }, [previewTheme]);

  const columns: DataTableColumn<DemoRow>[] = [
    { key: "id", title: "ID", width: 90, sortable: true },
    { key: "name", title: "SERVICE", sortable: true },
    { key: "status", title: "STATUS", filterOptions: [{ label: "Healthy", value: "Healthy" }, { label: "Pending", value: "Pending" }], render: (value) => <span className={value === "Healthy" ? "af-showcase-status is-good" : "af-showcase-status is-pending"}>{String(value)}</span> },
    { key: "updated", title: "UPDATED", sortable: true },
  ];

  return (
    <div className="af-showcase">
      <section className="af-showcase-intro">
        <div>
          <span className="af-showcase-kicker">DESIGN SYSTEM / GITHUB PRIMER</span>
          <h2>Shared UI components</h2>
          <p>GitHub Primer-aligned tokens, navigation primitives, form controls and data tables used across AgentForge.</p>
        </div>
        <div className="af-showcase-row">
          {primerThemes.map((theme) => (
            <Button
              key={theme.id}
              size="small"
              variant={previewTheme === theme.id ? "primary" : "secondary"}
              onClick={() => setPreviewTheme(theme.id)}
            >
              {theme.label}
            </Button>
          ))}
        </div>
      </section>

      <section className="af-showcase-section">
        <Subhead
          heading="Primer Theme & Canvas Tokens"
          description="Live preview across Dark default, Dark dimmed and Light default themes."
          actions={<Label variant="accent">{previewTheme}</Label>}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {canvasSwatches.map((swatch) => (
            <BorderBox key={swatch.token}>
              <div style={{ height: 48, background: `var(${swatch.token})`, borderBottom: "1px solid var(--borderColor-muted)" }} />
              <div style={{ padding: "8px 12px" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{swatch.name}</div>
                <code style={{ fontSize: 12, color: "var(--fgColor-muted)" }}>{swatch.token}</code>
              </div>
            </BorderBox>
          ))}
        </div>
      </section>

      <section className="af-showcase-section">
        <Subhead
          heading="UnderlineNav & Semantic Badges"
          description="Coral-orange active bar, StateLabel, Label pills, CounterLabel and BranchChip."
          actions={<BranchChip>feat/primer-ui-components</BranchChip>}
        />
        <BorderBox>
          <UnderlineNav
            ariaLabel="Showcase repository sections"
            activeKey={navTab}
            onChange={setNavTab}
            items={[
              { key: "code", label: "Code" },
              { key: "changesets", label: "Changesets", counter: 6 },
              { key: "pipelines", label: "CI / CD", counter: 2 },
              { key: "settings", label: "Settings" },
            ]}
          />
          <BorderBoxRow>
            <span style={{ color: "var(--fgColor-muted)", fontSize: 13 }}>
              Active UnderlineNav tab: <strong style={{ color: "var(--fgColor-default)" }}>{navTab}</strong>
            </span>
          </BorderBoxRow>
        </BorderBox>

        <div className="af-showcase-row">
          <StateLabel status="open">Open</StateLabel>
          <StateLabel status="merged">Merged</StateLabel>
          <StateLabel status="closed">Closed</StateLabel>
          <StateLabel status="draft" size="small">Draft</StateLabel>
          <Label variant="accent">ui-system</Label>
          <Label variant="success">verified</Label>
          <Label variant="done">dark-mode</Label>
          <Label variant="attention">needs-review</Label>
          <Label variant="danger">breaking</Label>
          <CounterLabel>42</CounterLabel>
          <CounterLabel scheme="secondary">7</CounterLabel>
        </div>
      </section>

      <section className="af-showcase-section">
        <Subhead
          heading="ActionList & BorderBox"
          description="Grouped settings navigation paired with standard and danger BorderBox containers."
        />
        <div className="af-showcase-grid">
          <BorderBox>
            <BorderBoxHeader>
              <strong>Settings Navigation</strong>
              <Label>{settingsSection}</Label>
            </BorderBoxHeader>
            <div style={{ padding: 12 }}>
              <ActionList>
                <ActionListGroup title="Organization">
                  <ActionListItem
                    active={settingsSection === "members"}
                    trailingVisual={<CounterLabel>5</CounterLabel>}
                    onClick={() => setSettingsSection("members")}
                  >
                    Members &amp; Invitations
                  </ActionListItem>
                  <ActionListItem
                    active={settingsSection === "general"}
                    onClick={() => setSettingsSection("general")}
                  >
                    General
                  </ActionListItem>
                </ActionListGroup>
                <ActionListGroup title="Access & Security">
                  <ActionListItem
                    active={settingsSection === "sso"}
                    onClick={() => setSettingsSection("sso")}
                  >
                    SSO &amp; SSH Keys
                  </ActionListItem>
                  <ActionListItem
                    danger
                    onClick={() => notify({ status: "warning", title: "Danger action", message: "Destructive actions require confirmation." })}
                  >
                    Delete organization
                  </ActionListItem>
                </ActionListGroup>
              </ActionList>
            </div>
          </BorderBox>

          <div style={{ display: "grid", gap: 12 }}>
            <BorderBox>
              <BorderBoxHeader>
                <strong>Active Changesets</strong>
                <CounterLabel>2</CounterLabel>
              </BorderBoxHeader>
              <BorderBoxRow hoverable style={{ justifyContent: "space-between" }}>
                <span>#184 feat(ui): adopt Primer tokens</span>
                <StateLabel status="open" size="small">Open</StateLabel>
              </BorderBoxRow>
              <BorderBoxRow hoverable style={{ justifyContent: "space-between" }}>
                <span>#181 fix(repo): clean hardcoded hex values</span>
                <StateLabel status="merged" size="small">Merged</StateLabel>
              </BorderBoxRow>
            </BorderBox>

            <BorderBox danger>
              <BorderBoxHeader>
                <strong style={{ color: "var(--fgColor-danger)" }}>Danger Zone</strong>
                <Label variant="danger">Restricted</Label>
              </BorderBoxHeader>
              <BorderBoxRow style={{ justifyContent: "space-between" }}>
                <span>Archive or permanently delete this workspace</span>
                <Button size="small" variant="danger" onClick={() => setConfirmOpen(true)}>Delete</Button>
              </BorderBoxRow>
            </BorderBox>
          </div>
        </div>
      </section>

      <section className="af-showcase-section">
        <Subhead
          heading="FilterBar, ButtonGroup & Diff Indicators"
          description="Syntax filter bar, joined button groups, 5-block DiffStat and Git FileStatusBadge."
          actions={
            <ButtonGroup ariaLabel="Diff view mode">
              <Button size="small" variant={diffViewMode === "unified" ? "primary" : "secondary"} onClick={() => setDiffViewMode("unified")}>Unified</Button>
              <Button size="small" variant={diffViewMode === "split" ? "primary" : "secondary"} onClick={() => setDiffViewMode("split")}>Split</Button>
            </ButtonGroup>
          }
        />
        <FilterBar
          value={filterQuery}
          onChange={setFilterQuery}
          onSubmit={setSubmittedFilter}
          placeholder="Filter changesets (e.g. is:open label:ui-system)..."
          ariaLabel="Showcase filter bar"
          filterPrefix={<Button size="medium" onClick={() => setFilterQuery("is:changeset is:open")}>Filters ▾</Button>}
          trailingControls={
            <ButtonGroup ariaLabel="Filter presets">
              <Button size="medium" onClick={() => setFilterQuery("is:open label:ui-system")}>Labels <CounterLabel>12</CounterLabel></Button>
              <Button size="medium" onClick={() => setFilterQuery("is:open milestone:v2.4")}>Milestones <CounterLabel>3</CounterLabel></Button>
            </ButtonGroup>
          }
          primaryAction={<Button variant="primary" onClick={() => setSubmittedFilter(filterQuery)}>Apply</Button>}
        />
        <div className="af-showcase-result">Submitted query: <b>{submittedFilter || "(empty)"}</b> · Diff mode: <b>{diffViewMode}</b></div>
        <BorderBox>
          <BorderBoxHeader>
            <strong>Changed files</strong>
            <DiffStat additions={142} deletions={38} />
          </BorderBoxHeader>
          <BorderBoxRow hoverable style={{ justifyContent: "space-between" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><FileStatusBadge status="added" /><code>apps/web/src/shared/ui/components/primer.tsx</code></span>
            <DiffStat additions={120} deletions={0} />
          </BorderBoxRow>
          <BorderBoxRow hoverable style={{ justifyContent: "space-between" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><FileStatusBadge status="modified" /><code>apps/web/src/shared/ui/theme/theme.css</code></span>
            <DiffStat additions={18} deletions={12} />
          </BorderBoxRow>
          <BorderBoxRow hoverable style={{ justifyContent: "space-between" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><FileStatusBadge status="renamed" /><code>docs/development/design-system/colors.md</code></span>
            <DiffStat additions={4} deletions={2} />
          </BorderBoxRow>
          <BorderBoxRow hoverable style={{ justifyContent: "space-between" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><FileStatusBadge status="deleted" /><code>apps/web/src/styles/legacy-sidebar.css</code></span>
            <DiffStat additions={0} deletions={24} />
          </BorderBoxRow>
        </BorderBox>
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
            <Empty title="No deployments yet" description="Create your first deployment to see runtime health and release history." action={<Button size="small" variant="primary">{t("common:resourceActions.deployment")}</Button>} />
          </div>
        </div>
      </section>

      <section className="af-showcase-section">
        <div className="af-showcase-section__heading"><div><h3>Data table</h3><p>Sortable columns, row selection and server-driven pagination callbacks.</p></div><span className="af-showcase-meta">{selectedRows.length} selected · {sortMessage}</span></div>
        <DataTable columns={columns} data={rows} rowKey="id" selectedRowKeys={selectedRows} onSelectionChange={setSelectedRows} onSort={(key, direction) => setSortMessage(direction ? key + " " + direction : "No sort applied")} bulkActions={<Button size="small" variant="danger" onClick={() => setSelectedRows([])}>Clear selection</Button>} pagination={{ page: 1, pageSize: 10, total: rows.length }} />
      </section>

      <Modal open={modalOpen} title={t("repositories:workspace.create")} onCancel={() => setModalOpen(false)} onOk={async () => { await new Promise((resolve) => window.setTimeout(resolve, 350)); setModalOpen(false); }}>
        <Form><Input label="Workspace name" defaultValue="new-workspace" /><Select label="Environment" defaultValue="development" options={environmentOptions} /></Form>
      </Modal>
      <Drawer open={drawerOpen} title="Service details" onClose={() => setDrawerOpen(false)}>
        <h3>API Gateway</h3><p>Service metadata and operational details can live in a side panel without losing list context.</p><p className="af-showcase-status is-good">Healthy</p>
      </Drawer>
      <ConfirmDialog open={confirmOpen} title="Delete workspace?" description="This is a demonstration. No workspace will actually be deleted." confirmText="Delete" danger onCancel={() => setConfirmOpen(false)} onConfirm={() => setConfirmOpen(false)} />
    </div>
  );
}
