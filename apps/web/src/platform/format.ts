import { addCalendarDays } from "@kobito/shared";

const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(date: string): [number, number, number] | null {
  const match = isoDate.exec(date);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** 2026-11-02 -> 2026年11月2日 */
export function formatDate(date: string): string {
  const p = parts(date);
  return p ? `${p[0]}年${p[1]}月${p[2]}日` : date;
}

/** 2026-11-02 -> 11月2日 */
export function formatMonthDay(date: string): string {
  const p = parts(date);
  return p ? `${p[1]}月${p[2]}日` : date;
}

/** 2026-11-02 -> 11/2 */
export function formatSlashDate(date: string): string {
  const p = parts(date);
  return p ? `${p[1]}/${p[2]}` : date;
}

/** 10000 -> 10,000円 */
export function formatYen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

/** The day after a period ends is the day the next period starts and bills. */
export function dayAfter(date: string): string {
  return addCalendarDays(date, 1);
}

/** ISO datetime -> Tokyo calendar date (YYYY-MM-DD). */
export function tokyoDateOf(dateTime: string): string {
  const instant = new Date(dateTime);
  if (Number.isNaN(instant.getTime())) return dateTime.slice(0, 10);
  const p = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    p.find((item) => item.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
