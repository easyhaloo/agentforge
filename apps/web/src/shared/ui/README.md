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
- `DataTable` supports sortable columns and controlled row selection. Use `sortMode="client"` for local sorting (default), or `sortMode="server"` with `onSort` to delegate sorting to the API layer.

## UI Showcase

Select **UI Components** in the sidebar to inspect and interact with the shared controls, including loading, error, date, overlay, remote select, sorting and selection states.

## Current limitations

- Date inputs use the browser-native date picker; visual details vary by browser/OS.
- Modal provides Escape and backdrop dismissal but does not yet implement a full focus trap.
- DataTable currently provides pagination and loading/empty states; column sorting, filtering, row selection, and virtualization are subsequent increments.
- AsyncSelect and Drawer are not part of this initial component batch.
