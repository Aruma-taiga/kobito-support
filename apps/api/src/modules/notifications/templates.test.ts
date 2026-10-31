import { describe, expect, it } from "vitest";
import {
  FakeMailSender,
  LogMailSender,
} from "../../integrations/mail/sender.js";
import { renderNotification } from "./templates.js";

describe("notification templates", () => {
  it("uses configured identity and explains that application receipt is not a contract", () => {
    const mail = renderNotification({
      kind: "NT-01",
      serviceName: "コビトサポート設定値",
      contactEmail: "contact@example.test",
      customerName: "申込者",
    });
    expect(mail.subject).toContain("申込み");
    expect(mail.text).toContain("コビトサポート設定値");
    expect(mail.text).toContain("contact@example.test");
    expect(mail.text).toContain("まだ契約は成立していません");
    expect(mail.text).toContain("ご入金を当社で確認した時点で契約成立");
    expect(mail.text).not.toMatch(/NT-0|S-03|customerId|applicationId/);
  });

  it("renders card invoice guidance without exposing payment data or identifiers", () => {
    const mail = renderNotification({
      kind: "NT-02",
      serviceName: "設定サービス",
      contactEmail: "contact@example.test",
      paymentMethod: "card",
      dueOn: "2026-11-08",
      amountInclTax: 11000,
      invoiceNo: "KS-PRIVATE-1",
    });
    expect(mail.text).toContain("マイページからお手続き");
    expect(mail.text).toContain("2026-11-08");
    expect(mail.text).toContain("11,000円（税込）");
    expect(mail.text).not.toContain("KS-PRIVATE-1");
    expect(mail.text).not.toMatch(
      /カード番号|セキュリティコード|有効期限|トークン/,
    );
  });

  it("renders configured bank details for bank transfer", () => {
    const mail = renderNotification({
      kind: "NT-02",
      serviceName: "設定サービス",
      contactEmail: "contact@example.test",
      paymentMethod: "bank_transfer",
      bankDetails: "テスト銀行 / 本店 / 普通 / 1234567 / テスト名義",
    });
    expect(mail.text).toContain("振込先: テスト銀行");
  });

  it("keeps the fake sender inspectable and the log sender free of message content and full addresses", async () => {
    const fake = new FakeMailSender();
    const mail = renderNotification({
      kind: "NT-05",
      serviceName: "設定サービス",
      contactEmail: "contact@example.test",
    });
    await fake.send({ to: "person@example.test", ...mail });
    expect(fake.messages).toHaveLength(1);

    const entries: string[] = [];
    await new LogMailSender((entry) => entries.push(entry)).send({
      to: "person@example.test",
      subject: mail.subject,
      text: "sensitive body sentinel",
    });
    expect(entries[0]).toContain("NT-05");
    expect(entries[0]).toContain("p***@example.test");
    expect(entries[0]).not.toContain("sensitive body sentinel");
    expect(entries[0]).not.toContain("person@example.test");
  });
});
