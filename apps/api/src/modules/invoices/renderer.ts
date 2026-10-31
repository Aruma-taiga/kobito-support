import { type InvoiceDetail, invoiceDetailSchema } from "@kobito/shared";
import { chromium } from "playwright-core";

export interface InvoicePdfRenderer {
  render(invoice: InvoiceDetail): Promise<Uint8Array>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function yen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

export function invoiceHtml(invoice: InvoiceDetail): string {
  invoice = invoiceDetailSchema.parse(invoice);
  const preview = invoice.preview;
  const voidedOn = invoice.voidedOn;
  const voidedDate = voidedOn
    ? `${Number(voidedOn.slice(0, 4))}年${Number(voidedOn.slice(5, 7))}月${Number(voidedOn.slice(8, 10))}日`
    : undefined;
  const issuer = invoice.issuer;
  const bank = [
    issuer.bankAccountName,
    issuer.bankAccountBranch,
    issuer.bankAccountType,
    issuer.bankAccountNumber,
  ].map((value) => value ?? "未設定");
  const lines = invoice.lines
    .map(
      (line) => `<tr>
    <td>${escapeHtml(line.description)}</td><td class="number">${line.quantity}</td>
    <td class="number">${yen(line.unitPriceExclTax)}</td><td class="number">${yen(line.amountExclTax)}</td>
  </tr>`,
    )
    .join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'">
    <style>
      @page { size:A4; margin:11mm; }
      * { box-sizing:border-box; }
      body { font-family:'Noto Sans CJK JP','Noto Sans JP','Yu Gothic',sans-serif; color:#18202b; font-size:10pt; }
      h1 { font-size:21pt; margin:0 0 5mm; letter-spacing:.12em; }
      h2 { font-size:12pt; margin:0 0 3mm; color:#334155; }
      .watermark { border:2px solid #b91c1c; color:#b91c1c; padding:2mm; font-weight:bold; text-align:center; margin-bottom:5mm; }
      .void-mark { position:fixed; top:42%; left:12%; transform:rotate(-28deg); border:4px solid #b91c1c; color:#b91c1c; opacity:.28; padding:4mm 18mm; font-size:56pt; font-weight:bold; z-index:10; pointer-events:none; }
      .row { display:flex; justify-content:space-between; gap:12mm; }
      .recipient { flex:1; font-size:14pt; font-weight:bold; border-bottom:1px solid #64748b; padding:2mm 0; }
      .number { text-align:right; white-space:nowrap; }
      .meta { min-width:62mm; line-height:1.8; }
      table { width:100%; border-collapse:collapse; margin-top:6mm; }
      th,td { border-bottom:1px solid #cbd5e1; padding:2mm 2mm; }
      th { background:#f1f5f9; text-align:left; }
      .totals { margin:3mm 0 5mm auto; width:65mm; line-height:1.7; }
      .grand { font-size:16pt; font-weight:bold; border-top:2px solid #334155; }
      .columns { display:flex; gap:14mm; margin-top:6mm; page-break-inside:avoid; }
      .panel { flex:1; border:1px solid #cbd5e1; padding:3mm; line-height:1.65; overflow-wrap:anywhere; }
      .small { color:#475569; font-size:8pt; margin:2mm 0 0; }
      .payment { margin-top:4mm; padding:3mm; background:#f8fafc; line-height:1.6; page-break-inside:avoid; }
    </style></head><body>
    ${voidedOn ? '<div class="void-mark">取消</div>' : ""}
    ${preview ? '<div class="watermark">開発用サンプル・お支払い不要 / 正式な請求書ではありません</div>' : ""}
    <h1>請求書</h1>
    <div class="row"><div class="recipient">${escapeHtml(invoice.billingName)} 御中</div>
      <div class="meta">請求書番号：${escapeHtml(invoice.invoiceNo)}<br>発行日：${invoice.issuedOn}<br>お支払期限：${invoice.dueOn}</div></div>
    <p>${voidedDate ? `この請求書は${escapeHtml(voidedDate)}に取り消されました。お支払いいただく必要はありません。` : "下記のとおりご請求申し上げます。"}</p>
    <div class="grand">ご請求金額　${yen(invoice.totalInclTax)}（税込）</div>
    <p>対象プラン：${escapeHtml(invoice.acceptedPlan.planName)}　月額${yen(invoice.acceptedPlan.monthlyPriceExclTax)}（税抜）　${invoice.acceptedPlan.credits}クレジット</p>
    <table><thead><tr><th>内容</th><th class="number">数量</th><th class="number">単価（税抜）</th><th class="number">金額（税抜）</th></tr></thead><tbody>${lines}</tbody></table>
    <div class="totals">小計（税抜）：${yen(invoice.totalExclTax)}<br>消費税（10%）：${yen(invoice.taxAmount)}<br><strong>ご請求金額（税込）：${yen(invoice.totalInclTax)}</strong></div>
    <div class="columns"><section class="panel"><h2>請求先</h2>${escapeHtml(invoice.billingName)}<br>${escapeHtml(invoice.billingAddress)}</section>
      <section class="panel"><h2>発行者</h2>${escapeHtml(issuer.companyName)}<br>${escapeHtml(issuer.companyAddress)}<br>登録番号：${escapeHtml(issuer.invoiceRegistrationNo ?? "未設定")}<br>${escapeHtml(issuer.serviceName)}</section></div>
    <div class="payment">${invoice.paymentMethod === "card" ? "<h2>クレジットカード</h2>マイページのお支払いページからカードでお支払いください。" : `<h2>銀行振込</h2>銀行：${escapeHtml(bank[0] ?? "未設定")}　支店：${escapeHtml(bank[1] ?? "未設定")}<br>口座種別：${escapeHtml(bank[2] ?? "未設定")}　口座番号：${escapeHtml(bank[3] ?? "未設定")}<br>振込手数料はお客様にてご負担ください。`}</div>
    <p class="small">${preview ? "この書類はレイアウト確認用のサンプルです。お支払いに使用できません。" : invoice.paymentMethod === "card" ? "お支払い期限までにマイページからお支払いください。" : "お支払い期限までにお振込みください。"}</p>
    </body></html>`;
}

export class ChromiumInvoicePdfRenderer implements InvoicePdfRenderer {
  constructor(
    private readonly executablePath = process.env.INVOICE_CHROMIUM_EXECUTABLE,
  ) {}

  async render(invoice: InvoiceDetail): Promise<Uint8Array> {
    if (!this.executablePath || !this.executablePath.startsWith("/")) {
      throw new Error("Invoice Chromium executable is not configured");
    }
    const browser = await chromium.launch({
      executablePath: this.executablePath,
      headless: true,
      // コンテナ（Cloud Run など）では、非特権のユーザー名前空間が使えず Chromium のサンドボックスが起動しない。
      // コンテナ側が隔離環境なので、Dockerfile で INVOICE_CHROMIUM_SANDBOX=false を設定する。それ以外は有効のまま。
      // この Chromium は、JavaScript 無効・外部通信を遮断・当方が作ったエスケープ済みの HTML だけを描画する。
      chromiumSandbox: process.env.INVOICE_CHROMIUM_SANDBOX !== "false",
      timeout: 15_000,
      args: ["--disable-dev-shm-usage"],
    });
    try {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        serviceWorkers: "block",
      });
      await context.route("**/*", (route) => route.abort());
      const page = await context.newPage();
      await page.setContent(invoiceHtml(invoice), {
        waitUntil: "load",
        timeout: 15_000,
      });
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const pdf = await Promise.race([
        page.pdf({
          format: "A4",
          printBackground: true,
          preferCSSPageSize: true,
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Invoice PDF rendering timed out")),
            15_000,
          );
        }),
      ]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
      if (
        pdf.byteLength < 8 ||
        pdf.byteLength > 5 * 1024 * 1024 ||
        !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))
      ) {
        throw new Error("Invoice PDF output is invalid");
      }
      return pdf;
    } finally {
      await browser.close();
    }
  }
}
