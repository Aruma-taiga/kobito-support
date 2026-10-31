export interface NotificationTemplateData {
  kind: string;
  serviceName: string;
  contactEmail: string;
  customerName?: string;
  shopName?: string;
  planName?: string;
  paymentMethod?: string;
  invoiceNo?: string;
  dueOn?: string;
  amountInclTax?: number;
  bankDetails?: string;
  credits?: number;
  extraCredits?: number;
  status?: string;
}

export interface RenderedMail {
  subject: string;
  text: string;
}

export function renderNotification(
  data: NotificationTemplateData,
): RenderedMail {
  const greeting = data.customerName ? `${data.customerName} 様\n\n` : "\n";
  const footer = `\n\n${data.serviceName}\nお問い合わせ: ${data.contactEmail}`;
  switch (data.kind) {
    case "NT-01":
      return {
        subject: "お申込みを受け付けました",
        text: `${greeting}お申込みを受け付けました。現在、当社で内容を審査しています。\n\nこの時点では、まだ契約は成立していません。審査完了後に請求書をお送りします。初月分のご入金を当社で確認した時点で契約成立となります。${footer}`,
      };
    case "S-03":
      return {
        subject: "新しい申込みがありました",
        text: `新しい申込みがありました。管理画面でご確認ください。${footer}`,
      };
    case "NT-02": {
      const payment =
        data.paymentMethod === "card"
          ? "カードでのお支払いは、マイページからお手続きください。"
          : `銀行振込にてお支払いください。${data.bankDetails ? `\n振込先: ${data.bankDetails}` : ""}`;
      return {
        subject: "初月分の請求書を発行しました",
        text: `${greeting}初月分の請求書を発行しました。請求書はマイページでご確認いただけます。\n${data.dueOn ? `お支払期日: ${data.dueOn}\n` : ""}${data.amountInclTax === undefined ? "" : `請求金額: ${data.amountInclTax.toLocaleString("ja-JP")}円（税込）\n`}${payment}\n\nご入金を確認後、契約成立となります。${footer}`,
      };
    }
    case "NT-02b":
      return {
        subject: "ご入金を確認しました",
        text: `${greeting}初月分のご入金を確認しました。これにより契約が成立しました。今後のお手続きはマイページからご確認いただけます。${footer}`,
      };
    case "NT-03": {
      if (data.extraCredits !== undefined) {
        const payment =
          data.paymentMethod === "card"
            ? "カードでのお支払いは、マイページからお手続きください。"
            : `銀行振込にてお支払いください。${data.bankDetails ? `\n振込先: ${data.bankDetails}` : ""}`;
        return {
          subject: "追加クレジットの請求書を発行しました",
          text: `${greeting}追加クレジットの請求書を発行しました。お支払い確認後にご利用いただけます。\n請求書: ${data.invoiceNo ?? "マイページ"}\n数量: ${data.extraCredits}個\n${data.dueOn ? `お支払期日: ${data.dueOn}\n` : ""}${data.amountInclTax === undefined ? "" : `請求金額: ${data.amountInclTax.toLocaleString("ja-JP")}円（税込）\n`}${payment}${footer}`,
        };
      }
      const payment =
        data.paymentMethod === "card"
          ? "カードでのお支払いは、マイページからお手続きください。"
          : `銀行振込にてお支払いください。${data.bankDetails ? `\n振込先: ${data.bankDetails}` : ""}`;
      return {
        subject: "月額分の請求書を発行しました",
        text: `${greeting}月額分の請求書を発行しました。請求書はマイページでご確認いただけます。\n${data.paymentMethod === "bank_transfer" && data.dueOn ? `お支払期日: ${data.dueOn}\n` : ""}${data.amountInclTax === undefined ? "" : `請求金額: ${data.amountInclTax.toLocaleString("ja-JP")}円（税込）\n`}${payment}${footer}`,
      };
    }
    case "NT-04":
      return {
        subject: "クレジットをご利用いただけます",
        text:
          data.extraCredits !== undefined
            ? `${greeting}追加クレジット${data.extraCredits}個のご入金を確認し、現在の利用期間でご利用いただけるようになりました。マイページで残数をご確認ください。${footer}`
            : `${greeting}月額分のご入金を確認し、クレジットをご利用いただけるようになりました。${data.credits === undefined ? "" : `今回ご利用いただけるクレジットは${data.credits}個です。`}マイページで残数と利用期限をご確認ください。${footer}`,
      };
    case "NT-06":
      return {
        subject: "お見積りをお送りしました",
        text: `${greeting}お見積りをお送りしました。内容をご確認のうえ、マイページからご回答ください。${footer}`,
      };
    case "NT-07":
      return {
        subject:
          data.status === "done"
            ? "ご依頼が完了しました"
            : "ご依頼を開始しました",
        text: `${greeting}${data.status === "done" ? "ご依頼が完了しました。" : "ご依頼の作業を開始しました。"}詳しい状況はマイページでご確認いただけます。${footer}`,
      };
    case "NT-05":
      return {
        subject: "カードのお支払いについて",
        text: `${greeting}カードのお支払いを確認できていません。マイページから請求書の状況をご確認のうえ、お支払い手続きをお願いいたします。すでにお支払い済みの場合は、行き違いのためご容赦ください。${footer}`,
      };
    default:
      throw new Error("Unsupported notification kind");
  }
}
