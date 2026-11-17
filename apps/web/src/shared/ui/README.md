# Shared UI component usage

Import shared controls from the public entry point:

```tsx
import {
  Button,
  AsyncSelect,
  ConfirmDialog,
  DataTable,
  Drawer,
  Popover,
  DatePicker,
  Form,
  FormItem,
  Input,
  Modal,
  SearchInput,
  Select,
} from "@/shared/ui";
```

## Input and select

```tsx
<Input
  label="Workspace name"
  name="name"
  value={name}
  onChange={(event) => setName(event.target.value)}
  error={nameError}
/>

<Select
  label="Environment"
  value={environment}
  onChange={(event) => setEnvironment(event.target.value)}
  options={[
    { label: "Development", value: "dev" },
    { label: "Production", value: "prod" },
  ]}
/>
```

## Date values

`DatePicker` and `DateRangePicker` use `YYYY-MM-DD` strings. Keep this string format at the API boundary; do not pass browser events or Date objects to API clients.

## Search

`SearchInput` is controlled. It calls `onChange` for each edit and calls `onSearch` after `debounceMs` (300ms by default), or immediately when Enter is pressed.

## Modal

`Modal` supports an asynchronous `onOk`. The confirm action enters a loading state while the promise is pending. Keep the modal mounted and control visibility with `open`.

## DataTable

`DataTable` is presentational and does not fetch data. The caller owns server-side pagination and passes `page`, `pageSize`, and `total`; `onPageChange` should trigger the next API request. Always provide a stable `rowKey`.

## Advanced components

- `AsyncSelect` accepts a `loadOptions(keyword, signal)` function. It debounces requests and aborts the previous request when the keyword changes or the menu closes. Keep `loadOptions` referentially stable (for example, define it outside the component or wrap it in `useCallback`).
- `Drawer` provides a side panel with Escape and backdrop dismissal.
- `ConfirmDialog` is a confirmation-oriented wrapper around `Modal`; asynchronous confirmation inherits the modal loading and error behavior.
- `Popover` toggles lightweight contextual content from its trigger.
- `DataTable` supports sortable columns, controlled row selection and optional row activation. Use `onRowClick` to handle row activation; rows become keyboard-focusable and activate with Enter or Space. Use `rowClassName` to apply state classes such as the selected-row treatment. Interactive controls inside a row do not trigger row activation. Use `sortMode="client"` for local sorting (default), or `sortMode="server"` with `onSort` to delegate sorting to the API layer.

## UI Showcase

Select **UI Components** in the sidebar to inspect and interact with the shared controls, including loading, error, date, overlay, remote select, sorting and selection states.

## Current limitations

- Date inputs use the browser-native date picker; visual details vary by browser/OS.
- DataTable supports filtering, column visibility, bulk actions and accessible row activation. Virtualization is intentionally deferred until performance measurements justify it.
- Popover currently closes through its trigger; outside-click dismissal and richer keyboard navigation are follow-up work.

## Extended form controls

- `TextArea` supports the same label, hint, error and size conventions as `Input`.
- `PasswordInput` keeps the input controlled/uncontrolled like a native input and provides an accessible visibility toggle. Set `showToggle={false}` when visibility must not be exposed.
- `NumberInput` is a native number input; use `min`, `max` and `step` for browser-level constraints and validate again at the API boundary.
- `Checkbox` is a native checkbox with a consistent label and hint layout.
- `RadioGroup` supports controlled `value/onChange` or `defaultValue`, disabled options and horizontal/vertical layouts.
- `Switch` is a checkbox with `role="switch"`; use it for immediate on/off preferences, not for a choice that requires a separate form submission.

All controls preserve native form behavior and accept standard input attributes such as `name`, `required`, `disabled` and `autoComplete`. Validation remains owned by the containing form; these components display supplied error text but do not impose a validation library.


## Feedback and async states

- `Alert` renders persistent inline information with `info`, `success`, `warning` or `error` status. Use `closable` for dismissible messages.
- `Empty` provides a consistent no-data state with optional description, icon and action.
- `Skeleton` renders animated placeholders. Set `lines`, `width`, `height` and `circle` to match the expected content shape.
- `Loading` provides an accessible spinner and label; use `overlay` inside a positioned container to block an area while it loads.
- `NotificationProvider` owns transient notifications. Wrap the relevant application subtree once, then call `useNotification().notify({ status, title, message, duration })` from descendants. A duration of `0` keeps a notification visible until dismissed. The provider exposes `dismiss(id)` and supports placement and a maximum visible count.

Prefer inline `Alert` for persistent context, `Notification` for completed user-triggered operations, `Empty` for genuinely empty collections, and `Skeleton` when the final content layout is known.
### DataTable filters, column visibility and bulk actions

`DataTable` can optionally show a column chooser, filter row and selection toolbar:

```tsx
<DataTable
  columns={[
    {
      key: "status",
      title: "Status",
      filterOptions: [
        { label: "Healthy", value: "healthy" },
        { label: "Pending", value: "pending" },
      ],
    },
  ]}
  data={rows}
  rowKey="id"
  filterMode="server"
  filters={filters}
  onFilterChange={(next) => {
    setFilters(next);
    setPage(1);
    // Fetch the next page using the new filters.
  }}
  selectedRowKeys={selectedKeys}
  onSelectionChange={setSelectedKeys}
  bulkActions={<Button onClick={archiveSelected}>Archive selected</Button>}
/>
```

- `filterOptions` enables a native select filter for a column. The default `filterMode="client"` filters the supplied rows by exact value; use `filterMode="server"` with `filters/onFilterChange` when the API owns filtering and pagination.
- `visibleColumnKeys/onVisibleColumnsChange` control visible columns. Without them, the table manages visibility internally. The built-in chooser keeps at least one data column visible.
- `bulkActions` renders only while at least one row is selected. The caller owns the action, authorization, confirmation and mutation lifecycle.
- Select-all applies to the rows currently supplied to the table (normally the current page), not every record on the server.
- Virtual scrolling is not included yet. Prefer server pagination for large datasets until a measured performance requirement justifies a virtualization dependency.
