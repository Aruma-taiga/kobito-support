interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export interface BillingPeriod {
  startsOn: string;
  endsOn: string;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new RangeError("Date must use YYYY-MM-DD format");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw new RangeError("Date is not a valid Gregorian calendar date");
  }
  return { year, month, day };
}

function formatDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function anchoredDate(anchor: CalendarDate, sequence: bigint): CalendarDate {
  const anchorMonthIndex = BigInt(anchor.year) * 12n + BigInt(anchor.month - 1);
  const targetMonthIndex = anchorMonthIndex + sequence;
  const targetYear = targetMonthIndex / 12n;
  if (targetYear < 1n || targetYear > 9999n) {
    throw new RangeError(
      "Billing period is outside the supported four-digit year range",
    );
  }
  const year = Number(targetYear);
  const month = Number(targetMonthIndex % 12n) + 1;
  return {
    year,
    month,
    day: Math.min(anchor.day, daysInMonth(year, month)),
  };
}

function previousDay(date: CalendarDate): CalendarDate {
  if (date.day > 1) return { ...date, day: date.day - 1 };
  if (date.month > 1) {
    const month = date.month - 1;
    return { year: date.year, month, day: daysInMonth(date.year, month) };
  }
  if (date.year === 1)
    throw new RangeError(
      "Billing period end is outside the supported date range",
    );
  return { year: date.year - 1, month: 12, day: 31 };
}

/**
 * sequence is zero-based: sequence 0 starts on the anchor date. Database
 * billing_periods.seq is one-based, so persist sequence + 1 there.
 */
export function periodFor(anchorDate: string, sequence: number): BillingPeriod {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError(
      "Billing period sequence must be a non-negative safe integer",
    );
  }
  const anchor = parseDate(anchorDate);
  const start = anchoredDate(anchor, BigInt(sequence));
  const nextStart = anchoredDate(anchor, BigInt(sequence) + 1n);
  return {
    startsOn: formatDate(start),
    endsOn: formatDate(previousDay(nextStart)),
  };
}

/** Returns whether candidateDate exactly matches a start on the original anchor day. */
export function isPeriodStart(
  anchorDate: string,
  candidateDate: string,
): boolean {
  const anchor = parseDate(anchorDate);
  const candidate = parseDate(candidateDate);
  const anchorIso = formatDate(anchor);
  const candidateIso = formatDate(candidate);
  if (candidateIso < anchorIso) return false;
  const sequence =
    (candidate.year - anchor.year) * 12 + candidate.month - anchor.month;
  if (sequence < 0) return false;
  return formatDate(anchoredDate(anchor, BigInt(sequence))) === candidateIso;
}
