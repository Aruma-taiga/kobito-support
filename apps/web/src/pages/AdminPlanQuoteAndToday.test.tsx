// @vitest-environment jsdom
// a02（今日やること）と a04-2（プランの見積りを作る）の画面を確かめる。

import { webMessages } from "@kobito/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthClient } from "../auth/admin-session.js";
import { AdminApiError } from "../platform/admin-api-client.js";
import type { AdminApiClient } from "./AdminApp.js";
import { AdminApp } from "./AdminApp.js";

const aobaId = "11111111-1111-4111-8111-111111111111";
const luceId = "22222222-2222-4222-8222-222222222222";
const contractId = "33333333-3333-4333-8333-333333333333";
const quoteId = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 2026-11-14 12:00 JST（土）
  vi.setSystemTime(new Date("2026-11-14T03:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const app = (over: Record<string, unknown>) => ({
  customerId: luceId,
  shopName: "美容室ルーチェ",
  contactName: "鈴木 一郎",
  email: "luce@example.jp",
  submittedAt: "2026-11-12T01:42:00.000Z",
  planName: "ライト",
  priceExclTax: 5000,
  credits: 1,
  paymentMethod: "bank_transfer" as const,
  status: "under_review" as const,
  ...over,
});
const invoice = (over: Record<string, unknown>) => ({
  id: "55555555-5555-4555-8555-555555555555",
  invoiceNo: "SP-2026-0080",
  kind: "initial" as const,
  status: "issued" as const,
  issuedOn: "2026-11-10",
  dueOn: "2026-11-17",
  totalInclTax: 11_000,
  totalExclTax: 10_000,
  taxAmount: 1_000,
  preview: false,
  paymentMethod: "bank_transfer" as const,
  ...over,
});
const lateInvoice = invoice({
  id: "66666666-6666-4666-8666-666666666666",
  invoiceNo: "SP-2026-0070",
  status: "overdue",
  dueOn: "2026-11-12",
});
const farInvoice = invoice({
  id: "77777777-7777-4777-8777-777777777777",
  invoiceNo: "SP-2026-0090",
  dueOn: "2026-11-30",
});
const paidInvoice = invoice({
  id: "88888888-8888-4888-8888-888888888888",
  invoiceNo: "SP-2026-0060",
  status: "paid",
  dueOn: "2026-11-15",
});
const request = (over: Record<string, unknown>) => ({
  id: "99999999-9999-4999-8999-999999999999",
  contractId,
  receivedOn: "2026-11-11",
  summary: "年末年始の休業のお知らせ",
  urgent: false,
  status: "received" as const,
  createdAt: "2026-11-11T00:00:00.000Z",
  latestEstimate: null,
  completion: null,
  ...over,
});

function adminClient(over: Record<string, unknown> = {}) {
  return {
    getSession: vi.fn(async () => ({ role: "admin" as const })),
    getApplications: vi.fn(async (query?: { status?: string }) => {
      const items =
        query?.status === "quoting"
          ? [
              app({
                customerId: aobaId,
                shopName: "カフェ あおば",
                planName: "個別見積り",
                priceExclTax: null,
                credits: null,
                status: "quoting",
              }),
            ]
          : [app({})];
      return { items, page: 1, pageSize: 100, total: items.length };
    }),
    getPendingBankTransfers: vi.fn(async () => ({
      items: [
        {
          invoice: invoice({}),
          customer: {
            id: luceId,
            shopName: "そろばん教室 みらい",
            billingName: "そろばん教室 みらい",
          },
          contractId,
        },
      ],
    })),
    getPaymentReviews: vi.fn(async () => ({
      events: [],
      failedInvoices: [],
      eventCount: 0,
      failedInvoiceCount: 0,
    })),
    getInvoices: vi.fn(async () => ({
      invoices: [invoice({}), lateInvoice, farInvoice, paidInvoice],
    })),
    getAdminRequests: vi.fn(async () => ({
      items: [
        request({}),
        request({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          summary: "Googleマップの営業時間",
          status: "in_progress",
        }),
        request({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          summary: "完了済み",
          status: "done",
        }),
      ],
    })),
    getRequestContracts: vi.fn(async () => ({
      items: [
        {
          contractId,
          customerId: aobaId,
          shopName: "喫茶ひだまり",
          contactName: "山田 花子",
          status: "active" as const,
        },
      ],
    })),
    getCustomerDetail: vi.fn(),
    getInvoiceReadiness: vi.fn(async () => ({
      canIssue: true,
      mode: "live" as const,
      reason: "ready" as const,
    })),
    ...over,
  } as unknown as AdminApiClient;
}

function setup(path: string, apiClient: AdminApiClient) {
  const user = { email: "a@example.jp", getIdToken: async () => "t" };
  const authClient: AdminAuthClient = {
    currentUser: () => user,
    subscribe: (listener) => {
      queueMicrotask(() => listener(user));
      return () => undefined;
    },
    signIn: vi.fn(),
    startSecondFactor: vi.fn(),
    completeSecondFactor: vi.fn(),
    cancelSecondFactor: vi.fn(),
    signOut: vi.fn(async () => undefined),
  };
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/admin/*"
          element={
            <AdminApp
              authClient={authClient}
              apiClient={apiClient}
              serviceName="kobITo Support"
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}
const text = () => document.body.textContent ?? "";

describe("a02 today's tasks", () => {
  it("is the admin top page and appears first in the menu", async () => {
    setup("/admin", adminClient());
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: webMessages.adminTodayTitle,
      }),
    ).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "管理メニュー" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "今日やること",
      "顧客",
      "依頼",
      "入金確認",
      "請求書",
      "紹介・報酬",
      "設定",
    ]);
    expect(
      within(nav)
        .getByRole("link", { name: "今日やること" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(text()).toContain("11月14日（土）");
  });

  it("lists counts and short rows for each kind of task", async () => {
    const client = adminClient();
    setup("/admin", client);
    await screen.findByText("カフェ あおば");
    await screen.findAllByText("そろばん教室 みらい");
    await screen.findByText("Googleマップの営業時間");
    const review = (await screen.findByText("審査待ちの申込み")).closest(
      "section",
    ) as HTMLElement;
    expect(review.textContent).toContain("美容室ルーチェ");
    expect(
      within(review)
        .getByRole("link", { name: "審査する" })
        .getAttribute("href"),
    ).toBe(`/admin/customers/${luceId}`);
    expect(client.getApplications).toHaveBeenCalledWith(
      expect.objectContaining({ status: "under_review" }),
    );

    const quote = screen
      .getByText("プランの見積りを作る申込み")
      .closest("section") as HTMLElement;
    expect(quote.textContent).toContain("カフェ あおば");
    expect(
      within(quote)
        .getByRole("link", { name: "見積りを作る" })
        .getAttribute("href"),
    ).toBe(`/admin/customers/${aobaId}/plan-quote`);

    const bank = screen
      .getByText("銀行振込の消し込み")
      .closest("section") as HTMLElement;
    expect(bank.textContent).toContain("そろばん教室 みらい");
    expect(bank.textContent).toContain("期限 11/17（あと3日）");

    const requestsNeedingEstimate = screen
      .getByText("見積を作る依頼")
      .closest("section") as HTMLElement;
    expect(requestsNeedingEstimate.textContent).toContain(
      "年末年始の休業のお知らせ",
    );
    expect(requestsNeedingEstimate.textContent).toContain("喫茶ひだまり");
    const started = screen
      .getByText("了承された依頼（着手する）")
      .closest("section") as HTMLElement;
    expect(started.textContent).toContain("Googleマップの営業時間");
    expect(text()).not.toContain("完了済み");
  });

  it("shows safe payment review and failed invoice summaries, and friendly empty states", async () => {
    const client = adminClient({
      getPaymentReviews: vi.fn(async () => ({
        events: [
          {
            eventId: "evt_hidden",
            eventType: "payment.captured",
            invoiceNo: "KS-2026-0088",
            receivedAt: "2026-11-14T01:00:00.000Z",
            reason: "amount_mismatch",
            notificationAmount: 10000,
            invoiceTotal: 11000,
            shopName: "喫茶こびと",
          },
        ],
        failedInvoices: [
          {
            invoiceId: "12121212-1212-4212-8212-121212121212",
            invoiceNo: "KS-2026-0077",
            shopName: "美容室みどり",
            totalInclTax: 5500,
            reasonCode: "payment.failed",
            dueOn: "2026-11-20",
          },
        ],
        eventCount: 1,
        failedInvoiceCount: 1,
      })),
    });
    setup("/admin", client);
    await waitFor(() => expect(client.getPaymentReviews).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByText("入金の要確認").closest("section")?.textContent,
      ).not.toContain("読み込んでいます"),
    );
    await screen.findByText("喫茶こびと");
    const review = (await screen.findByText("入金の要確認")).closest(
      "section",
    ) as HTMLElement;
    expect(review.textContent).toContain("喫茶こびと");
    expect(review.textContent).toContain("入金額が請求書と一致しません");
    expect(review.textContent).toContain("KS-2026-0088");
    expect(review.textContent).not.toContain("evt_hidden");
    const failed = (await screen.findByText("お支払いの失敗")).closest(
      "section",
    ) as HTMLElement;
    expect(failed.textContent).toContain("美容室みどり");
    expect(failed.textContent).toContain("KS-2026-0077");
    expect(failed.textContent).toContain("お支払いが完了しませんでした");
    expect(failed.textContent).not.toContain("payment_declined");

    cleanup();
    setup(
      "/admin",
      adminClient({
        getPaymentReviews: vi.fn(async () => ({
          events: [],
          failedInvoices: [],
          eventCount: 0,
          failedInvoiceCount: 0,
        })),
      }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByText(webMessages.adminTodayEmpty).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it("flags unpaid invoices due within 7 days or overdue, and ignores paid or distant ones", async () => {
    setup("/admin", adminClient());
    await screen.findAllByText(/SP-2026-0070/);
    const due = (await screen.findByText("期限が近い請求")).closest(
      "section",
    ) as HTMLElement;
    expect(due.textContent).toContain("SP-2026-0080");
    expect(due.textContent).toContain("期限 11/17（あと3日）");
    expect(due.textContent).toContain("SP-2026-0070");
    expect(due.textContent).toContain("期限 11/12（2日超過）");
    expect(due.textContent).not.toContain("SP-2026-0090");
    expect(due.textContent).not.toContain("SP-2026-0060");
    expect(
      within(due)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      // 期限の近い順（超過が先頭）
      "/admin/invoices/66666666-6666-4666-8666-666666666666",
      "/admin/invoices/55555555-5555-4555-8555-555555555555",
    ]);
  });

  it("shows a friendly empty line and keeps other panels when one fails", async () => {
    setup(
      "/admin",
      adminClient({
        getPendingBankTransfers: vi.fn(async () => {
          throw new AdminApiError("server");
        }),
        getAdminRequests: vi.fn(async () => ({ items: [] })),
      }),
    );
    const bank = (await screen.findByText("銀行振込の消し込み")).closest(
      "section",
    ) as HTMLElement;
    await waitFor(() =>
      expect(bank.textContent).toContain(webMessages.adminTodayPanelError),
    );
    expect(
      within(bank).getByRole("button", { name: webMessages.adminTodayRetry }),
    ).toBeTruthy();
    const estimate = screen
      .getByText("見積を作る依頼")
      .closest("section") as HTMLElement;
    expect(estimate.textContent).toContain(webMessages.adminTodayEmpty);
    expect(text()).toContain("美容室ルーチェ");
  });

  it("uses no card, LINE or convenience-store wording and no internal terms", async () => {
    setup("/admin", adminClient());
    await screen.findByText("審査待ちの申込み");
    for (const banned of ["コンビニ", "LINE", "カード", "工数", "API"]) {
      expect(text()).not.toContain(banned);
    }
  });
});

const sentQuote = {
  id: quoteId,
  version: 1,
  priceExclTax: 25_000,
  taxAmount: 2_500,
  priceInclTax: 27_500,
  credits: 8,
  description: "ホームページの更新\n定例の相談",
  expiresOn: "2026-11-28",
  sentAt: "2026-11-13T03:00:00.000Z",
  approvedAt: null,
  supersededAt: null,
  status: "awaiting" as const,
};
function quoteDetail(over: Record<string, unknown> = {}) {
  return {
    customer: {
      id: aobaId,
      shopName: "カフェ あおば",
      contactName: "青葉 太郎",
    },
    contract: { id: contractId, status: "quoting" as const },
    application: {
      planName: "個別見積り",
      paymentMethod: "bank_transfer" as const,
      submittedAt: "2026-11-12T01:42:00.000Z",
      freeText: "予約の受付と会員カードをまとめて見たい",
    },
    quotes: [],
    expectedVersion: 0,
    canCreate: true,
    today: "2026-11-14",
    ...over,
  };
}

describe("a04-2 make a plan quote", () => {
  it("shows the form with the application summary and a default expiry of 14 days", async () => {
    setup(
      `/admin/customers/${aobaId}/plan-quote`,
      adminClient({ getPlanQuote: vi.fn(async () => quoteDetail()) }),
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /プランの見積り/,
      }),
    ).toBeTruthy();
    expect(text()).toContain("カフェ あおば");
    expect(text()).toContain("見積り作成中");
    expect(text()).toContain("予約の受付と会員カードをまとめて見たい");
    const expiry = screen.getByLabelText(/有効期限/) as HTMLInputElement;
    expect(expiry.value).toBe("2026-11-28");
    expect(screen.getByLabelText(/月額（税抜）/)).toBeTruthy();
    expect(text()).not.toContain("税込）必須");
  });

  it("shows the tax-inclusive amount (floor rule) as the price is typed", async () => {
    setup(
      `/admin/customers/${aobaId}/plan-quote`,
      adminClient({ getPlanQuote: vi.fn(async () => quoteDetail()) }),
    );
    const price = await screen.findByLabelText(/月額（税抜）/);
    fireEvent.change(price, { target: { value: "12345" } });
    expect(text()).toContain("税込 13,579円（消費税 1,234円）");
  });

  it("validates before sending and sends integers with the version the admin saw", async () => {
    const sendPlanQuote = vi.fn(async () => ({
      quote: { ...sentQuote, priceExclTax: 25_000 },
      contractStatus: "awaiting_quote_approval" as const,
    }));
    const getPlanQuote = vi
      .fn()
      .mockResolvedValueOnce(quoteDetail())
      .mockResolvedValue(
        quoteDetail({
          contract: { id: contractId, status: "awaiting_quote_approval" },
          quotes: [sentQuote],
          expectedVersion: 1,
        }),
      );
    setup(
      `/admin/customers/${aobaId}/plan-quote`,
      adminClient({ getPlanQuote, sendPlanQuote }),
    );
    const send = await screen.findByRole("button", {
      name: webMessages.adminPlanQuoteSend,
    });
    fireEvent.click(send);
    expect(sendPlanQuote).not.toHaveBeenCalled();
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(/月額（税抜）/), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText(/毎月のクレジット/), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText(/内容/), {
      target: { value: "ホームページの更新\n定例の相談" },
    });
    fireEvent.click(send);
    expect(sendPlanQuote).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/月額（税抜）/), {
      target: { value: "25000" },
    });
    fireEvent.change(screen.getByLabelText(/有効期限/), {
      target: { value: "2026-11-14" },
    });
    fireEvent.click(send);
    expect(sendPlanQuote).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/有効期限/), {
      target: { value: "2026-11-28" },
    });
    fireEvent.click(send);
    await waitFor(() => expect(sendPlanQuote).toHaveBeenCalledTimes(1));
    expect(sendPlanQuote).toHaveBeenCalledWith(aobaId, {
      expectedVersion: 0,
      priceExclTax: 25_000,
      credits: 8,
      description: "ホームページの更新\n定例の相談",
      expiresOn: "2026-11-28",
    });
    expect(
      await screen.findByText(webMessages.adminPlanQuoteSent),
    ).toBeTruthy();
    // 送った版が履歴に出て、見えるのは税抜主表示＋税込
    await waitFor(() => expect(text()).toContain("第1版"));
    expect(text()).toContain("25,000円（税抜）");
    expect(text()).toContain("27,500円（税込）");
  });

  it("sends the next version from the screen after a quote was already sent, and says the old one becomes void", async () => {
    const sendPlanQuote = vi.fn(async () => ({
      quote: { ...sentQuote, version: 2 },
      contractStatus: "awaiting_quote_approval" as const,
    }));
    setup(
      `/admin/customers/${aobaId}/plan-quote`,
      adminClient({
        getPlanQuote: vi.fn(async () =>
          quoteDetail({
            contract: { id: contractId, status: "awaiting_quote_approval" },
            quotes: [sentQuote],
            expectedVersion: 1,
          }),
        ),
        sendPlanQuote,
      }),
    );
    expect(
      await screen.findByText(webMessages.adminPlanQuoteResendHint),
    ).toBeTruthy();
    // 送った版は編集できず、履歴として読むだけ
    expect(text()).toContain("第1版");
    expect(text()).toContain("了承待ち");
    fireEvent.change(screen.getByLabelText(/月額（税抜）/), {
      target: { value: "30000" },
    });
    fireEvent.change(screen.getByLabelText(/毎月のクレジット/), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText(/内容/), {
      target: { value: "新しい内容" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminPlanQuoteSend }),
    );
    await waitFor(() => expect(sendPlanQuote).toHaveBeenCalled());
    expect(sendPlanQuote).toHaveBeenCalledWith(
      aobaId,
      expect.objectContaining({ expectedVersion: 1, priceExclTax: 30_000 }),
    );
  });

  it("does not offer a new version once the customer approved", async () => {
    setup(
      `/admin/customers/${aobaId}/plan-quote`,
      adminClient({
        getPlanQuote: vi.fn(async () =>
          quoteDetail({
            contract: { id: contractId, status: "awaiting_payment" },
            quotes: [
              {
                ...sentQuote,
                approvedAt: "2026-11-14T00:00:00.000Z",
                status: "approved",
              },
            ],
            expectedVersion: 1,
            canCreate: false,
          }),
        ),
      }),
    );
    expect(
      await screen.findByText(webMessages.adminPlanQuoteApproved),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: webMessages.adminPlanQuoteSend }),
    ).toBeNull();
    expect(text()).toContain("了承済み");
  });

  it("explains a conflict from the server without hiding the form", async () => {
    setup(
      `/admin/customers/${aobaId}/plan-quote`,
      adminClient({
        getPlanQuote: vi.fn(async () => quoteDetail()),
        sendPlanQuote: vi.fn(async () => {
          throw new AdminApiError("plan_quote_conflict");
        }),
      }),
    );
    fireEvent.change(await screen.findByLabelText(/月額（税抜）/), {
      target: { value: "25000" },
    });
    fireEvent.change(screen.getByLabelText(/毎月のクレジット/), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText(/内容/), {
      target: { value: "内容" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminPlanQuoteSend }),
    );
    expect(
      await screen.findByText(webMessages.adminPlanQuoteConflict),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: webMessages.adminPlanQuoteSend }),
    ).toBeTruthy();
  });

  it("links from the customer detail of a quoting contract to the quote screen", async () => {
    const getCustomerDetail = vi.fn(async () => ({
      customer: {
        id: aobaId,
        shopName: "カフェ あおば",
        contactName: "青葉 太郎",
        email: "aoba@example.jp",
        phone: null,
        billingName: "カフェ あおば",
        billingAddress: "東京都1-2-3",
        invoiceRegistrationNo: null,
      },
      application: {
        id: "99999999-0000-4000-8000-000000000000",
        submittedAt: "2026-11-12T01:42:00.000Z",
        paymentMethod: "bank_transfer" as const,
        termsVersion: "t",
        privacyVersion: "p",
        disclosureVersion: "d",
        consentBusinessUse: true,
        consentTerms: true,
        consentMarketing: false,
        consentPartnerShare: null,
        shownTerms: {
          planName: "個別見積り",
          priceExclTax: null,
          credits: null,
        },
        referralCode: null,
        freeText: null,
        reviewResult: "approved" as const,
        rejectionNote: null,
      },
      contract: { id: contractId, status: "quoting" as const },
    }));
    setup(`/admin/customers/${aobaId}`, adminClient({ getCustomerDetail }));
    const link = await screen.findByRole("link", {
      name: webMessages.adminPlanQuoteCreate,
    });
    expect(link.getAttribute("href")).toBe(
      `/admin/customers/${aobaId}/plan-quote`,
    );
  });
});
