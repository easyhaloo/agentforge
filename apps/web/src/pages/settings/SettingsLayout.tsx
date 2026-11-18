import { Outlet } from "react-router-dom";
import { SettingsSidebar } from "./SettingsSidebar";
import "./settings.css";

interface SettingsLayoutProps {
  // User data will be passed from the route element
  username: string;
  displayName: string;
  avatarUrl?: string;
  // Notify function for toasts
  onNotify: (message: string) => void;
}

export interface SettingsOutletContext {
  notify: (message: string) => void;
}

export function SettingsLayout({ username, displayName, avatarUrl, onNotify }: SettingsLayoutProps) {
  const context: SettingsOutletContext = { notify: onNotify };

  return (
    <div className="settings-layout">
      <aside className="settings-sidebar">
        <SettingsSidebar
          username={username}
          displayName={displayName}
          avatarUrl={avatarUrl}
        />
      </aside>
      <main className="settings-content">
        <Outlet context={context} />
      </main>
    </div>
  );
}
