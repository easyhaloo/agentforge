import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { activeLanguage, setAccountTimeZone, useDateFormatting } from "./format";

const utcEvening = new Date("2020-01-01T18:00:00Z");

afterEach(() => setAccountTimeZone(undefined));

it("updates existing formatters when account timezone arrives and falls back when it is invalid or cleared", () => {
  const { result } = renderHook(() => useDateFormatting());
  const browserTime = utcEvening.toLocaleString(activeLanguage(), { dateStyle: "medium", timeStyle: "short" });
  expect(result.current.formatDateTime(utcEvening)).toBe(browserTime);

  act(() => setAccountTimeZone("UTC"));
  expect(result.current.formatCalendarDay(utcEvening)).toBe("Wed Jan 01 2020");
  const utcTime = result.current.formatDateTime(utcEvening);

  act(() => setAccountTimeZone("Asia/Tokyo"));
  expect(result.current.formatCalendarDay(utcEvening)).toBe("Thu Jan 02 2020");
  expect(result.current.formatDateTime(utcEvening)).not.toBe(utcTime);
  expect(result.current.formatRelativeTime(utcEvening)).toBe(utcEvening.toLocaleDateString(activeLanguage(), {
    dateStyle: "medium", timeZone: "Asia/Tokyo",
  }));

  act(() => setAccountTimeZone("Invalid/Timezone"));
  expect(result.current.formatDateTime(utcEvening)).toBe(browserTime);
  act(() => setAccountTimeZone("Asia/Tokyo"));
  act(() => setAccountTimeZone(undefined));
  expect(result.current.formatDateTime(utcEvening)).toBe(browserTime);
});
