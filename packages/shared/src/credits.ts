export const creditEntryKinds = [
  "grant",
  "extra",
  "reserve",
  "release",
  "consume",
  "expire",
] as const;

export type CreditEntryKind = (typeof creditEntryKinds)[number];

export interface CreditEntry {
  periodId: string;
  kind: CreditEntryKind;
  amount: number;
}

export interface CreditDelta {
  kind: "release" | "consume";
  amount: number;
}

const positiveKinds = new Set<CreditEntryKind>(["grant", "extra", "release"]);
const negativeKinds = new Set<CreditEntryKind>([
  "reserve",
  "consume",
  "expire",
]);

function assertCreditCount(
  value: number,
  label: string,
  allowZero: boolean,
): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new RangeError(
      `${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer`,
    );
  }
}

/** Returns a balance for each period ID; entries from different periods never combine. */
export function balanceOf(
  entries: readonly CreditEntry[],
): ReadonlyMap<string, number> {
  const totals = new Map<string, bigint>();
  for (const entry of entries) {
    if (!entry.periodId.trim())
      throw new RangeError("Credit entry period ID must not be empty");
    if (!creditEntryKinds.includes(entry.kind))
      throw new RangeError("Unknown credit entry kind");
    if (!Number.isSafeInteger(entry.amount)) {
      throw new RangeError("Credit entry amount must be a safe integer");
    }
    if (positiveKinds.has(entry.kind) && entry.amount < 0) {
      throw new RangeError(`${entry.kind} credit entries must be non-negative`);
    }
    if (negativeKinds.has(entry.kind) && entry.amount > 0) {
      throw new RangeError(`${entry.kind} credit entries must be non-positive`);
    }
    totals.set(
      entry.periodId,
      (totals.get(entry.periodId) ?? 0n) + BigInt(entry.amount),
    );
  }
  const balances = new Map<string, number>();
  for (const [periodId, total] of totals) {
    if (
      total > BigInt(Number.MAX_SAFE_INTEGER) ||
      total < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new RangeError(
        `Credit balance for period ${periodId} exceeds the safe integer range`,
      );
    }
    balances.set(periodId, Number(total));
  }
  return balances;
}

/** Checks one period's balance; callers must not sum balances across periods. */
export function canApprove(estimateCredits: number, balance: number): boolean {
  assertCreditCount(estimateCredits, "Estimate credits", false);
  if (!Number.isSafeInteger(balance)) {
    throw new RangeError("Available balance must be a safe integer");
  }
  return estimateCredits <= balance;
}

/** Pure completion deltas; the database layer supplies the reservation period. */
export function completionEntries(
  reservedCredits: number,
  actualCredits: number,
): readonly [CreditDelta, CreditDelta] {
  assertCreditCount(reservedCredits, "Reserved credits", false);
  assertCreditCount(actualCredits, "Actual credits", true);
  return [
    { kind: "release", amount: reservedCredits },
    { kind: "consume", amount: -actualCredits },
  ];
}

/** Stamps completion deltas with the estimate's original period, never a current-period guess. */
export function completionEntriesForPeriod(
  sourcePeriodId: string,
  reservedCredits: number,
  actualCredits: number,
): readonly [CreditEntry, CreditEntry] {
  if (!sourcePeriodId.trim())
    throw new RangeError("Source period ID must not be empty");
  const [release, consume] = completionEntries(reservedCredits, actualCredits);
  return [
    { ...release, periodId: sourcePeriodId },
    { ...consume, periodId: sourcePeriodId },
  ];
}
