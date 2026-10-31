import type { InvoiceDetail } from "@kobito/shared";
import { useState } from "react";
import { safeFilename } from "./invoice-format.js";

/** 請求書PDFを取得してブラウザのダウンロードとして保存する。 */
export function useInvoicePdfDownload(
  client: { getInvoicePdf(id: string): Promise<Blob> },
  invoice: Pick<InvoiceDetail, "id" | "invoiceNo"> | null,
) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  async function downloadPdf() {
    if (!invoice || downloading) return;
    setDownloading(true);
    setDownloadError(false);
    let objectUrl: string | null = null;
    try {
      const blob = await client.getInvoicePdf(invoice.id);
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${safeFilename(invoice.invoiceNo)}.pdf`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
      const createdUrl = objectUrl;
      if (createdUrl) {
        window.setTimeout(() => URL.revokeObjectURL(createdUrl), 0);
      }
    }
  }

  return { downloading, downloadError, downloadPdf };
}
