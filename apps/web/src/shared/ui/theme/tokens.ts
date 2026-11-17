export const agentForgeTokens = {
  color: {
    primary: "#8878f6",
    primaryHover: "#9a8cff",
    success: "#65c89b",
    warning: "#e5a66b",
    danger: "#e28d98",
    info: "#65a9e8",
    text: "#e8eaf2",
    textSecondary: "#98a3b8",
    textMuted: "#69758c",
    border: "#273248",
    surface: "#101725",
    surfaceRaised: "#141c2b",
    background: "#090d16",
  },
  radius: { small: 5, medium: 7, large: 10, xlarge: 12 },
  spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 },
  controlHeight: { small: 28, medium: 34, large: 40 },
  zIndex: { dropdown: 5, sticky: 6, overlay: 10, toast: 20 },
} as const;

export type AgentForgeTokens = typeof agentForgeTokens;
