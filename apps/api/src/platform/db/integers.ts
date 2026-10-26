/** Convert PostgreSQL integer/numeric text without rounding unsafe values. */
export function safePgInteger(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new RangeError("Database integer is outside the safe range");
    return value;
  }
  if (!/^-?\d+$/.test(value))
    throw new RangeError("Database integer has an invalid representation");
  const parsed = BigInt(value);
  if (
    parsed > BigInt(Number.MAX_SAFE_INTEGER) ||
    parsed < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new RangeError("Database integer is outside the safe range");
  return Number(parsed);
}
