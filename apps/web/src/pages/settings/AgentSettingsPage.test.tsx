import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { AgentSettingsPage } from "./AgentSettingsPage";

vi.mock("react-router-dom", () => ({
  useOutletContext: () => ({
    notify: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AgentSettingsPage", () => {
  const mockAgentPrefs = {
    output_verbosity: "standard" as const,
    confirmation_strategy: "batch" as const,
    automation_level: "balanced" as const,
    cross_session_memory_enabled: true,
    auto_evaluate_on_push: true,
    notify_evaluation_results: true,
    evaluation_strictness: "standard" as const,
    agent_review_enabled: true,
    agent_can_approve_low_risk: false,
    review_focus: {
      security: true,
      performance: true,
      code_style: false,
      test_coverage: true,
      documentation: false,
    },
  };

  it("shows loading state on initial render", () => {
    const html = renderToStaticMarkup(<AgentSettingsPage />);

    expect(html).toContain("agents.title");
    expect(html).toContain("agents.description");
    expect(html).toContain("common:status.loading");
  });

  it("renders agent settings page structure", () => {
    const html = renderToStaticMarkup(<AgentSettingsPage />);

    expect(html).toContain("agents.title");
    expect(html).toContain("agents.description");
    expect(html).toContain("settings-page");
  });
});
