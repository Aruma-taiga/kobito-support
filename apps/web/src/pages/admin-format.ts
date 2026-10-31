import {
  type ContractStatus,
  contractStatusLabels,
  inclYenFor,
  webMessages,
} from "@kobito/shared";
import { formatYen } from "../platform/format.js";
import type { BadgeTone } from "../ui/index.js";

export function formatJstDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

/** 申込み日時を「11/12 10:42」の形にする。 */
export function formatJstShort(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

export function formatPaymentMethod(method: string): string {
  if (method === "bank_transfer") return webMessages.applicationBankTransfer;
  if (method === "card") return webMessages.applicationCardPayment;
  return "";
}

/** 「5,000円（税抜）／5,500円（税込）」。税込は税抜から共有の計算で求める。 */
export function formatExclIncl(priceExclTax: number): string {
  return `${formatYen(priceExclTax)}${webMessages.adminPriceExclSuffix}／${formatYen(inclYenFor(priceExclTax))}${webMessages.adminPriceInclSuffix}`;
}

export function formatPlanSummary(
  name: string,
  priceExclTax: number | null,
  credits: number | null,
): string {
  if (priceExclTax === null || credits === null) {
    return `${name}：${webMessages.applicationCustomQuoteAfterReview}`;
  }
  return webMessages.adminQueuePlanSummaryFixed
    .replace("{name}", name)
    .replace("{price}", priceExclTax.toLocaleString("ja-JP"))
    .replace("{inclPrice}", inclYenFor(priceExclTax).toLocaleString("ja-JP"))
    .replace("{credits}", String(credits));
}

export function contractStatusTone(status: ContractStatus): BadgeTone {
  switch (status) {
    case "under_review":
    case "quoting":
    case "awaiting_quote_approval":
      return "yellow";
    case "active":
      return "sage";
    case "cancel_scheduled":
      return "dark";
    default:
      return "gray";
  }
}

export function contractStatusLabel(status: ContractStatus): string {
  return contractStatusLabels[status];
}
