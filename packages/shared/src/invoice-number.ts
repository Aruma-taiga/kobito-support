const PREFIX_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export function formatInvoiceNo(
  prefix: string,
  year: number,
  sequence: number,
): string {
  if (prefix.length < 1 || prefix.length > 20 || !PREFIX_PATTERN.test(prefix)) {
    throw new RangeError(
      "Invoice prefix must contain only letters, digits, and internal hyphens",
    );
  }
  if (!Number.isSafeInteger(year) || year < 1 || year > 9999) {
    throw new RangeError(
      "Invoice year must be a four-digit positive safe integer",
    );
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError("Invoice sequence must be a positive safe integer");
  }
  return `${prefix}-${String(year).padStart(4, "0")}-${String(sequence).padStart(5, "0")}`;
}
