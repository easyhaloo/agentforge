import { useSyncExternalStore } from "react";
import i18n from "../../locales";

/**
 * Date, time and relative-time formatting.
 *
 * The interface language and the browser locale are two different things: a reader who chose
 * Chinese sees Chinese dates even on an English browser. Every timestamp therefore goes through
 * these helpers, which format in the language the interface is rendered in.
 *
 * The account timezone is applied to calendar dates; relative durations use elapsed time.
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

type DateValue = string | number | Date | null | undefined;
let accountTimeZone: string | undefined;
const listeners = new Set<() => void>();

/** Use the browser timezone when there is no account preference or Intl cannot interpret it. */
export function setAccountTimeZone(timeZone: string | undefined): void {
  if (timeZone === "") timeZone = undefined;
  if (timeZone) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone });
    } catch {
      timeZone = undefined;
    }
  }
  if (accountTimeZone === timeZone) return;
  accountTimeZone = timeZone;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A date and time, in the language the interface is rendered in and account timezone. */
export function formatDateTime(value: DateValue, timeZone?: string): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleString(activeLanguage(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

/** A date without its time, in the language the interface is rendered in and account timezone. */
export function formatDate(value: DateValue, timeZone?: string): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString(activeLanguage(), {
    dateStyle: "medium",
    timeZone,
  });
}

/**
 * How long ago something happened, in words.
 *
 * Anything older than a week is shown as a date instead, which reads better than "42 days ago".
 * Relative durations (< 7 days) are timezone-independent. Older dates use the account timezone.
 */
export function formatRelativeTime(value: DateValue, timeZone?: string): string {
  const date = toDate(value);
  if (!date) return "";

  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return i18n.t("common:time.justNow");
  if (minutes < 60) return i18n.t("common:time.minutesAgo", { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t("common:time.hoursAgo", { count: hours });

  const days = Math.floor(hours / 24);
  if (days < 7) return i18n.t("common:time.daysAgo", { count: days });

  return formatDate(date, timeZone);
}

/** Stable date key for repository history URLs, compatible with the original toDateString keys. */
export function formatCalendarDay(value: DateValue, timeZone?: string): string {
  const date = toDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "2-digit", year: "numeric",
  }).formatToParts(date);
  return ["weekday", "month", "day", "year"].map(type => parts.find(part => part.type === type)?.value).join(" ");
}

/** Subscribe once so already rendered dates update when account preferences arrive. */
export function useDateFormatting() {
  const timeZone = useSyncExternalStore(subscribe, () => accountTimeZone, () => undefined);
  return {
    formatDateTime: (value: DateValue) => formatDateTime(value, timeZone),
    formatDate: (value: DateValue) => formatDate(value, timeZone),
    formatRelativeTime: (value: DateValue) => formatRelativeTime(value, timeZone),
    formatCalendarDay: (value: DateValue) => formatCalendarDay(value, timeZone),
  };
}
