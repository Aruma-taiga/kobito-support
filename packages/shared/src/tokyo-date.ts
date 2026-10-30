/** Converts an instant to its YYYY-MM-DD calendar date in Japan Standard Time. */
export function toTokyoDate(instant: Date): string {
  if (!Number.isFinite(instant.getTime())) {
    throw new RangeError("Tokyo date requires a valid instant");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const fields = new Map(parts.map(({ type, value }) => [type, value]));
  const year = fields.get("year");
  const month = fields.get("month");
  const day = fields.get("day");
  if (!year || !month || !day) {
    throw new RangeError("Unable to determine Tokyo calendar date");
  }
  return `${year}-${month}-${day}`;
}
