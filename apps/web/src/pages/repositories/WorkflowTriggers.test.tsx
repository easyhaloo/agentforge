import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { TFunction } from "i18next";
import { WorkflowTriggers } from "./WorkflowTriggers";
import { APIError, translateError } from "../../shared/api/errors";
import type { WorkflowTrigger } from "../../shared/api/pipelines";
import type { Summary } from "../../shared/api/pipelines";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const triggers = vi.fn();
const enableTrigger = vi.fn();
const disableTrigger = vi.fn();
vi.mock("../../shared/api/pipelines", () => ({
  pipelines: {
    triggers: (...args: unknown[]) => triggers(...args),
    enableTrigger: (...args: unknown[]) => enableTrigger(...args),
    disableTrigger: (...args: unknown[]) => disableTrigger(...args),
  },
}));

const workflow = { id: "release", version: 2, status: "published", disabled: false } as Summary;
const owner = { canManage: true };

beforeEach(() => {
  triggers.mockReset();
  enableTrigger.mockReset();
  disableTrigger.mockReset();
});

describe("WorkflowTriggers tag binding", () => {
  it("enables a tag trigger with its pattern", async () => {
    const user = userEvent.setup();
    triggers.mockResolvedValue({ items: [] });
    const binding: WorkflowTrigger = { id: "t1", kind: "tag", version: 2, tagPattern: "v*" };
    enableTrigger.mockResolvedValue(binding);
    render(<WorkflowTriggers org="org1" workflow={workflow} {...owner} onClose={() => {}} />);
    await waitFor(() => expect(triggers).toHaveBeenCalled());
    // Pick the tag kind from the event selector.
    const select = await screen.findByRole("combobox", { name: "actions.event" });
    await user.click(select);
    await user.click(screen.getByRole("option", { name: "actions.events.tag" }));
    const pattern = screen.getByLabelText("actions.triggers.tagPattern");
    expect(pattern).toHaveValue("v*");
    await user.click(screen.getByRole("button", { name: "actions.triggers.enable" }));
    await waitFor(() => expect(enableTrigger).toHaveBeenCalledWith("org1", "release", { kind: "tag", version: 2, tagPattern: "v*" }));
  });

  it("disables the enable button while the pattern is invalid", async () => {
    const user = userEvent.setup();
    triggers.mockResolvedValue({ items: [] });
    render(<WorkflowTriggers org="org1" workflow={workflow} {...owner} onClose={() => {}} />);
    const select = await screen.findByRole("combobox", { name: "actions.event" });
    await user.click(select);
    await user.click(screen.getByRole("option", { name: "actions.events.tag" }));
    const pattern = screen.getByLabelText("actions.triggers.tagPattern");
    await user.clear(pattern);
    await user.type(pattern, "../escape");
    expect(screen.getByRole("button", { name: "actions.triggers.enable" })).toBeDisabled();
    expect(screen.getByText("actions.triggers.tagPatternHint")).toBeInTheDocument();
    expect(enableTrigger).not.toHaveBeenCalled();
  });

  it("lists an existing tag trigger with its pattern", async () => {
    triggers.mockResolvedValue({ items: [{ id: "t1", kind: "tag", version: 1, tagPattern: "release-*" }] });
    render(<WorkflowTriggers org="org1" workflow={workflow} {...owner} onClose={() => {}} />);
    // The label text mixes translated segments; assert on the pattern code element instead.
    expect(await screen.findByText("release-*")).toBeInTheDocument();
    expect(screen.getByText(/actions\.events\.tag/)).toBeInTheDocument();
  });

  it("shows the duplicate-rule message when the API answers 409", async () => {
    const user = userEvent.setup();
    triggers.mockResolvedValue({ items: [] });
    enableTrigger.mockRejectedValue(new APIError("Check the workflow and disable existing bindings of this type", 409, undefined, "Trigger conflict"));
    render(<WorkflowTriggers org="org1" workflow={workflow} {...owner} onClose={() => {}} />);
    const select = await screen.findByRole("combobox", { name: "actions.event" });
    await user.click(select);
    await user.click(screen.getByRole("option", { name: "actions.events.tag" }));
    await user.click(screen.getByRole("button", { name: "actions.triggers.enable" }));
    await waitFor(() => expect(enableTrigger).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toHaveTextContent("errors:duplicateTrigger");
  });

  it("translates a 409 trigger conflict to the duplicate-rule message", () => {
    const t = ((key: string) => (key === "errors:duplicateTrigger" ? "已存在相同规则。" : key)) as unknown as TFunction;
    const cause = new APIError("Check the workflow and disable existing bindings of this type", 409, undefined, "Trigger conflict");
    expect(translateError(cause, t, "repositories:actions.triggers.failed")).toBe("已存在相同规则。");
  });
});
