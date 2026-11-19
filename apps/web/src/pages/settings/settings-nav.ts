import { Bell, Bot, Key, Lock, Monitor, Palette, Settings, User, type LucideIcon } from "lucide-react";

/**
 * The settings navigation.
 *
 * The labels are translation keys rather than sentences so that the settings pages never carry a
 * hardcoded English string. `architecture/i18n-keys.test.ts` resolves every key listed here.
 */

export type SettingsNavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
};

export type SettingsNavGroup = {
  titleKey: string;
  items: SettingsNavItem[];
};

/** The personal settings, listed above the grouped ones. */
export const settingsNavItems: SettingsNavItem[] = [
  { to: "/settings/profile", labelKey: "nav.profile", icon: User },
  { to: "/settings/account", labelKey: "nav.account", icon: Settings },
  { to: "/settings/appearance", labelKey: "nav.appearance", icon: Palette },
  { to: "/settings/notifications", labelKey: "nav.notifications", icon: Bell },
];

/** The grouped settings. */
export const settingsNavGroups: SettingsNavGroup[] = [
  {
    titleKey: "nav.groupAccess",
    items: [
      { to: "/settings/authentication", labelKey: "nav.authentication", icon: Lock },
      { to: "/settings/keys", labelKey: "nav.keys", icon: Key },
      { to: "/settings/sessions", labelKey: "nav.sessions", icon: Monitor },
    ],
  },
  {
    titleKey: "nav.groupCode",
    items: [
      { to: "/settings/agents", labelKey: "nav.agents", icon: Bot },
    ],
  },
];
