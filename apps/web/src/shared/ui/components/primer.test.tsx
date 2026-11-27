import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ActionList,
  ActionListGroup,
  ActionListItem,
  BorderBox,
  BorderBoxHeader,
  BorderBoxRow,
  BranchChip,
  ButtonGroup,
  CounterLabel,
  DiffStat,
  FileStatusBadge,
  FilterBar,
  Label,
  StateLabel,
  Subhead,
  UnderlineNav,
  computeDiffStatBlocks,
} from "./primer";

describe("GitHub Primer shared primitives", () => {
  it("renders CounterLabel, Label, StateLabel and BranchChip with semantic classes", () => {
    const { container } = render(
      <div>
        <CounterLabel>12</CounterLabel>
        <CounterLabel scheme="secondary">3</CounterLabel>
        <Label variant="accent">ui-system</Label>
        <StateLabel status="merged" size="small">Merged</StateLabel>
        <BranchChip>feat/primer-ui</BranchChip>
      </div>,
    );

    expect(container.querySelector(".af-counter")?.textContent).toBe("12");
    expect(container.querySelector(".af-counter--secondary")?.textContent).toBe("3");
    expect(container.querySelector(".af-label--accent")?.textContent).toBe("ui-system");
    expect(container.querySelector(".af-state-label--merged.af-state-label--small")?.textContent).toBe("Merged");
    expect(container.querySelector(".af-branch-chip")?.textContent).toBe("feat/primer-ui");
  });

  it("renders BorderBox with header, hoverable rows and danger variant", () => {
    const { container } = render(
      <BorderBox danger>
        <BorderBoxHeader>Danger Zone</BorderBoxHeader>
        <BorderBoxRow hoverable>Delete organization</BorderBoxRow>
      </BorderBox>,
    );

    expect(container.querySelector(".af-box--danger")).not.toBeNull();
    expect(container.querySelector(".af-box__header")?.textContent).toBe("Danger Zone");
    expect(container.querySelector(".af-box__row--hover")?.textContent).toBe("Delete organization");
  });

  it("renders Subhead with heading, description, actions and danger style", () => {
    const { container } = render(
      <Subhead
        heading="Organization profile"
        description="Manage workspace identity"
        actions={<button type="button">Save</button>}
        danger
      />,
    );

    expect(container.querySelector(".af-subhead--danger")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Organization profile" })).toBeTruthy();
    expect(screen.getByText("Manage workspace identity")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("renders UnderlineNav with coral active state, counters and click switching", () => {
    const onChange = vi.fn();
    render(
      <UnderlineNav
        ariaLabel="Repository sections"
        activeKey="code"
        onChange={onChange}
        items={[
          { key: "code", label: "Code" },
          { key: "changesets", label: "Changesets", counter: 6 },
          { key: "disabled", label: "Settings", disabled: true },
        ]}
      />,
    );

    const codeBtn = screen.getByRole("button", { name: "Code" });
    const changesetsBtn = screen.getByRole("button", { name: /Changesets/ });
    const disabledBtn = screen.getByRole("button", { name: "Settings" });

    expect(codeBtn.getAttribute("aria-current")).toBe("page");
    expect(changesetsBtn.getAttribute("aria-current")).toBeNull();
    expect(changesetsBtn.textContent).toContain("6");
    expect(disabledBtn.hasAttribute("disabled")).toBe(true);

    fireEvent.click(changesetsBtn);
    expect(onChange).toHaveBeenCalledWith("changesets");
  });

  it("renders grouped ActionList items with active indicator and click callbacks", () => {
    const onSelect = vi.fn();
    render(
      <ActionList>
        <ActionListGroup title="Organization">
          <ActionListItem active trailingVisual={<CounterLabel>5</CounterLabel>}>
            Members
          </ActionListItem>
          <ActionListItem danger onClick={onSelect}>
            Delete
          </ActionListItem>
        </ActionListGroup>
      </ActionList>,
    );

    expect(screen.getByText("Organization")).toBeTruthy();
    const membersBtn = screen.getByRole("button", { name: /Members/ });
    const deleteBtn = screen.getByRole("button", { name: "Delete" });

    expect(membersBtn.getAttribute("aria-current")).toBe("page");
    expect(deleteBtn.className).toContain("af-action-list__item--danger");

    fireEvent.click(deleteBtn);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("computes 5 proportional DiffStat blocks across zero, small and large totals", () => {
    expect(computeDiffStatBlocks(0, 0)).toEqual(["neutral", "neutral", "neutral", "neutral", "neutral"]);
    expect(computeDiffStatBlocks(1, 2)).toEqual(["add", "del", "del", "neutral", "neutral"]);
    expect(computeDiffStatBlocks(10, 0)).toEqual(["add", "add", "add", "add", "add"]);
    expect(computeDiffStatBlocks(0, 8)).toEqual(["del", "del", "del", "del", "del"]);
    expect(computeDiffStatBlocks(99, 1)).toEqual(["add", "add", "add", "add", "del"]);
    expect(computeDiffStatBlocks(1, 99)).toEqual(["add", "del", "del", "del", "del"]);
  });

  it("renders DiffStat, FileStatusBadge and ButtonGroup with semantic markup", () => {
    const { container } = render(
      <div>
        <DiffStat additions={6} deletions={3} />
        <FileStatusBadge status="added" />
        <FileStatusBadge status="modified" />
        <FileStatusBadge status="deleted" />
        <FileStatusBadge status="renamed" />
        <ButtonGroup ariaLabel="View mode">
          <button type="button" className="af-button">Unified</button>
          <button type="button" className="af-button">Split</button>
        </ButtonGroup>
      </div>,
    );

    expect(screen.getByLabelText("+6 -3")).toBeTruthy();
    expect(container.querySelectorAll(".af-diff-stat__block")).toHaveLength(5);
    expect(container.querySelector(".af-file-status--added")?.textContent).toBe("A");
    expect(container.querySelector(".af-file-status--modified")?.textContent).toBe("M");
    expect(container.querySelector(".af-file-status--deleted")?.textContent).toBe("D");
    expect(container.querySelector(".af-file-status--renamed")?.textContent).toBe("R");
    expect(screen.getByRole("group", { name: "View mode" })).toBeTruthy();
  });

  it("supports FilterBar submit, debounce and clear with focus restoration", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const onClear = vi.fn();

    const { rerender } = render(
      <FilterBar
        value="is:open"
        onChange={onChange}
        onSubmit={onSubmit}
        onClear={onClear}
        ariaLabel="Filter changesets"
        debounceMs={200}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Filter changesets" });
    fireEvent.change(input, { target: { value: "is:merged" } });
    expect(onChange).toHaveBeenCalledWith("is:merged");

    rerender(
      <FilterBar
        value="is:merged"
        onChange={onChange}
        onSubmit={onSubmit}
        onClear={onClear}
        ariaLabel="Filter changesets"
        debounceMs={200}
      />,
    );
    vi.advanceTimersByTime(200);
    expect(onSubmit).toHaveBeenCalledWith("is:merged");

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("");
    expect(document.activeElement).toBe(input);

    vi.useRealTimers();
  });
});
