# Shared UI component usage

Import shared controls from the public entry point:

```tsx
import {
  Button,
  DataTable,
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

## Current limitations

- Date inputs use the browser-native date picker; visual details vary by browser/OS.
- Modal provides Escape and backdrop dismissal but does not yet implement a full focus trap.
- DataTable currently provides pagination and loading/empty states; column sorting, filtering, row selection, and virtualization are subsequent increments.
- AsyncSelect and Drawer are not part of this initial component batch.
