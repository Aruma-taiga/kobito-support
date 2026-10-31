import { type InvoiceListItem, webMessages } from "@kobito/shared";

export function yen(value: number): string {
  return `￥${value.toLocaleString("ja-JP")}`;
}

export function invoiceStatus(status: InvoiceListItem["status"]): string {
  const labels: Record<InvoiceListItem["status"], string> = {
    issued: webMessages.invoiceStatusIssued,
    paid: webMessages.invoiceStatusPaid,
    failed: webMessages.invoiceStatusFailed,
    overdue: webMessages.invoiceStatusOverdue,
    void: webMessages.invoiceStatusVoid,
  };
  return labels[status];
}

export function safeFilename(invoiceNo: string): string {
  return invoiceNo.replace(/[^\p{L}\p{N}._-]/gu, "_");
}
