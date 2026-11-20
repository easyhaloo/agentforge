import i18n from "../../locales";

/**
 * Date, time and relative-time formatting.
 *
 * The interface language and the browser locale are two different things: a reader who chose
 * Chinese sees Chinese dates even on an English browser. Every timestamp therefore goes through
 * these helpers, which format in the language the interface is rendered in.
 */

/** The language the interface is currently rendered in. */
export function activeLanguage(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? "en-US";
}

/** The date behind a value, or null when the value does not describe one. */
function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A date and time, in the language the interface is rendered in. */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleString(activeLanguage(), { dateStyle: "medium", timeStyle: "short" });
}

/** A date without its time, in the language the interface is rendered in. */
export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString(activeLanguage(), { dateStyle: "medium" });
}

/**
 * How long ago something happened, in words.
 *
 * Anything older than a week is shown as a date instead, which reads better than "42 days ago".
 */
export function formatRelativeTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";

  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return i18n.t("common:time.justNow");
  if (minutes < 60) return i18n.t("common:time.minutesAgo", { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t("common:time.hoursAgo", { count: hours });

  const days = Math.floor(hours / 24);
  if (days < 7) return i18n.t("common:time.daysAgo", { count: days });

  return formatDate(date);
}
