import { z } from "zod";
import type { ContractStatus } from "./states.js";

export const retentionStatusSchema = z.enum(["ended", "lapsed", "declined"]);

export const retentionItemSchema = z.strictObject({
  customerId: z.uuid(),
  shopName: z.string(),
  status: retentionStatusSchema,
  baseDate: z.iso.date(),
  dueDate: z.iso.date(),
  daysRemaining: z.number().int(),
});
export const retentionListSchema = z.array(retentionItemSchema);
export type RetentionItem = z.infer<typeof retentionItemSchema>;

export function addCalendarYear(date: string): string {
  const [year, month, day] = parseCalendarDate(date);
  const nextYear = year + 1;
  const maxDay = new Date(Date.UTC(nextYear, month, 0)).getUTCDate();
  return `${String(nextYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, maxDay)).padStart(2, "0")}`;
}

export function previousCalendarDay(date: string): string {
  const [year, month, day] = parseCalendarDate(date);
  return new Date(Date.UTC(year, month - 1, day - 1))
    .toISOString()
    .slice(0, 10);
}

export function calendarDaysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = parseCalendarDate(from);
  const [toYear, toMonth, toDay] = parseCalendarDate(to);
  return (
    (Date.UTC(toYear, toMonth - 1, toDay) -
      Date.UTC(fromYear, fromMonth - 1, fromDay)) /
    86_400_000
  );
}

function parseCalendarDate(value: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RangeError("Invalid calendar date");
  const parts = value.split("-").map(Number) as [number, number, number];
  if (
    new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
      .toISOString()
      .slice(0, 10) !== value
  )
    throw new RangeError("Invalid calendar date");
  return parts;
}

export function retentionDueDate(
  status: ContractStatus,
  transitionedOn: string,
): string | null {
  if (status !== "ended" && status !== "lapsed" && status !== "declined")
    return null;
  return addCalendarYear(transitionedOn);
}
