import { createContext, useContext, type PropsWithChildren } from "react";
import { agentForgeTokens, type AgentForgeTokens } from "./tokens";

const ThemeContext = createContext<AgentForgeTokens>(agentForgeTokens);

export function UIThemeProvider({ children }: PropsWithChildren) {
  return (
    <ThemeContext.Provider value={agentForgeTokens}>
      <div className="af-ui-root">{children}</div>
    </ThemeContext.Provider>
  );
}

export function useUITheme() {
  return useContext(ThemeContext);
}
