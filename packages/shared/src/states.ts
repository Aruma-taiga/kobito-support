export const contractStatuses = [
  "under_review",
  "quoting",
  "awaiting_quote_approval",
  "awaiting_payment",
  "active",
  "cancel_scheduled",
  "ended",
  "declined",
  "lapsed",
] as const;

export type ContractStatus = (typeof contractStatuses)[number];

export const invoiceStatuses = [
  "issued",
  "paid",
  "failed",
  "overdue",
  "void",
] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];
export const invoiceKinds = ["initial", "monthly", "extra_credit"] as const;
export type InvoiceKind = (typeof invoiceKinds)[number];

export const requestStatuses = [
  "received",
  "awaiting_approval",
  "in_progress",
  "done",
  "withdrawn",
] as const;
export type RequestStatus = (typeof requestStatuses)[number];

const contractEdges = new Set<string>([
  "under_review>awaiting_payment",
  "under_review>quoting",
  "under_review>declined",
  "quoting>awaiting_quote_approval",
  "awaiting_quote_approval>quoting",
  "awaiting_quote_approval>awaiting_payment",
  "awaiting_quote_approval>lapsed",
  "awaiting_payment>active",
  "awaiting_payment>lapsed",
  "active>cancel_scheduled",
  "cancel_scheduled>active",
  "cancel_scheduled>ended",
]);

const invoiceEdges = new Set<string>([
  "issued>paid",
  "issued>failed",
  "issued>overdue",
  "issued>void",
  "failed>void",
  "overdue>void",
  "failed>paid",
  "overdue>paid",
]);

const requestEdges = new Set<string>([
  "received>awaiting_approval",
  "received>withdrawn",
  "awaiting_approval>in_progress",
  "awaiting_approval>withdrawn",
  "in_progress>done",
]);

export function canTransitionContract(
  from: ContractStatus,
  to: ContractStatus,
): boolean {
  return contractEdges.has(`${from}>${to}`);
}

/** Canonical contract transition check. Use the named variants for other domains. */
export const canTransition = canTransitionContract;

export function canTransitionInvoice(
  from: InvoiceStatus,
  to: InvoiceStatus,
): boolean {
  return invoiceEdges.has(`${from}>${to}`);
}

/** A request may be withdrawn only before work begins. */
export function canTransitionRequest(
  from: RequestStatus,
  to: RequestStatus,
): boolean {
  return requestEdges.has(`${from}>${to}`);
}
