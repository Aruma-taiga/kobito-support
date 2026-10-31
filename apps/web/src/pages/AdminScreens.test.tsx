// @vitest-environment jsdom
// 管理画面の見た目・文言・金額表示がモック（a01〜a08）に合っていることを確かめる。

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthClient } from "../auth/admin-session.js";
import type { AdminApiClient } from "./AdminApp.js";
import { AdminApp } from "./AdminApp.js";

const customerId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const contractId = "33333333-3333-4333-8333-333333333333";
const invoiceId = "44444444-4444-4444-8444-444444444444";
const requestId = "99999999-9999-4999-8999-999999999999";
const estimateId = "88888888-8888-4888-8888-888888888888";

const invoice = {
  id: invoiceId,
  invoiceNo: "SP-2026-0080",
  kind: "initial" as const,
  status: "issued" as const,
  issuedOn: "2026-10-26",
  dueOn: "2026-11-02",
  totalInclTax: 11000,
  totalExclTax: 10000,
  taxAmount: 1000,
  preview: false,
  paymentMethod: "bank_transfer" as const,
};
const queueItem = {
  customerId,
  shopName: "美容室ルーチェ",
  contactName: "鈴木 一郎",
  email: "luce@example.jp",
  submittedAt: "2026-10-26T01:00:00.000Z",
  planName: "ライト",
  priceExclTax: 5000,
  credits: 1,
  paymentMethod: "bank_transfer" as const,
  status: "under_review" as const,
};
const detail = {
  customer: {
    id: customerId,
    shopName: "美容室ルーチェ",
    contactName: "鈴木 一郎",
    email: "luce@example.jp",
    phone: "090-0000-0000",
    billingName: "美容室ルーチェ",
    billingAddress: "東京都杉並区1-2-3",
    invoiceRegistrationNo: null,
  },
  application: {
    id: applicationId,
    submittedAt: queueItem.submittedAt,
    paymentMethod: "bank_transfer" as const,
    termsVersion: "terms-v1",
    privacyVersion: "privacy-v1",
    disclosureVersion: "disclosure-v1",
    consentBusinessUse: true,
    consentTerms: true,
    consentMarketing: false,
    consentPartnerShare: null,
    shownTerms: { planName: "ライト", priceExclTax: 5000, credits: 1 },
    referralCode: null,
    freeText: "予約をネットで受けたい。",
    reviewResult: null,
    rejectionNote: null,
  },
  contract: { id: contractId, status: "under_review" as const },
};
const estimate = {
  id: estimateId,
  requestId,
  version: 1,
  credits: 1,
  dueOn: "2026-11-25",
  workItems: ["休業のお知らせを掲載する"],
  doneCriteria: "3か所に休業の期間が表示されている状態",
  exclusions: null,
  customerPrep: null,
  sentAt: "2026-10-26T00:00:00.000Z",
  approvedAt: null,
  supersededAt: null,
};
const adminRequest = {
  id: requestId,
  contractId,
  receivedOn: "2026-10-26",
  summary: "年末年始の休業のお知らせ",
  urgent: false,
  status: "received" as const,
  createdAt: "2026-10-26T00:00:00.000Z",
  latestEstimate: null,
  completion: null,
  customer: { customerId, shopName: "喫茶ひだまり", contactName: "山田 花子" },
  estimates: [],
};

function setup(path: string, overrides: Record<string, unknown> = {}) {
  const user = { email: "a@example.jp", getIdToken: async () => "t" };
  const authClient: AdminAuthClient = {
    currentUser: () => user,
    subscribe: (listener) => {
      queueMicrotask(() => listener(user));
      return () => undefined;
    },
    signIn: vi.fn(async () => ({
      status: "mfa_required" as const,
      factors: [
        { uid: "totp-1", factorId: "totp" as const, displayName: "認証アプリ" },
      ],
    })),
    startSecondFactor: vi.fn(async () => undefined),
    completeSecondFactor: vi.fn(async () => undefined),
    cancelSecondFactor: vi.fn(),
    signOut: vi.fn(async () => undefined),
  };
  const apiClient = {
    getSession: vi.fn(async () => ({ role: "admin" as const })),
    getApplications: vi.fn(async () => ({
      items: [
        queueItem,
        {
          ...queueItem,
          customerId: "55555555-5555-4555-8555-555555555555",
          shopName: "喫茶ひだまり",
          status: "active" as const,
        },
      ],
      page: 1,
      pageSize: 25,
      total: 2,
    })),
    getCustomerDetail: vi.fn(async () => detail),
    getInvoiceReadiness: vi.fn(async () => ({
      canIssue: true,
      mode: "live" as const,
      reason: "ready" as const,
    })),
    getInvoices: vi.fn(async () => ({
      invoices: [
        invoice,
        {
          ...invoice,
          id: "66666666-6666-4666-8666-666666666666",
          invoiceNo: "SP-2026-0058",
          status: "paid" as const,
        },
      ],
    })),
    getPendingBankTransfers: vi.fn(async () => ({
      items: [
        {
          invoice,
          customer: {
            id: customerId,
            shopName: "そろばん教室 みらい",
            billingName: "そろばん教室 みらい",
          },
          contractId,
        },
      ],
    })),
    getAdminRequests: vi.fn(async () => ({
      items: [
        adminRequest,
        {
          ...adminRequest,
          id: "77777777-7777-4777-8777-777777777777",
          summary: "メニュー表の差し替え",
          status: "in_progress" as const,
          latestEstimate: estimate,
        },
      ],
    })),
    getAdminRequest: vi.fn(async () => adminRequest),
    getIssuerSettings: vi.fn(async () => ({
      settings: {
        serviceName: "kobITo Support",
        companyName: "",
        companyAddress: "",
        invoiceRegistrationNo: null,
        invoicePrefix: "SP",
        bankAccount: {
          bankName: "",
          branchName: "",
          accountType: "",
          accountNumber: "",
          accountHolder: "",
        },
      },
      revision: "a".repeat(64),
      issuanceReady: false,
    })),
    ...overrides,
  } as unknown as AdminApiClient;
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
  return { apiClient, authClient };
}

afterEach(cleanup);

describe("admin shell (mock a03〜a08)", () => {
  it("shows the side menu with only the screens that exist, marking the current one", async () => {
    setup("/admin/customers");
    const nav = await screen.findByRole("navigation", { name: "管理メニュー" });
    const links = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(links).toEqual(["顧客", "依頼", "入金確認", "請求書", "設定"]);
    const current = within(nav).getByRole("link", { name: "顧客" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("管理画面")).toBeTruthy();
    // 新規APIが要る画面や、LINE・コンビニの入口は出さない
    expect(
      within(nav).queryByText(/今日やること|紹介|LINE|コンビニ/),
    ).toBeNull();
    expect(
      within(nav).getByRole("button", { name: "ログアウト" }),
    ).toBeTruthy();
  });
});

describe("a01 admin login", () => {
  function loginSetup() {
    const authClient: AdminAuthClient = {
      currentUser: () => null,
      subscribe: (listener) => {
        queueMicrotask(() => listener(null));
        return () => undefined;
      },
      signIn: vi.fn(async () => ({
        status: "mfa_required" as const,
        factors: [
          {
            uid: "totp-1",
            factorId: "totp" as const,
            displayName: "認証アプリ",
          },
        ],
      })),
      startSecondFactor: vi.fn(async () => undefined),
      completeSecondFactor: vi.fn(async () => undefined),
      cancelSecondFactor: vi.fn(),
      signOut: vi.fn(async () => undefined),
    };
    render(
      <MemoryRouter initialEntries={["/admin/login"]}>
        <Routes>
          <Route
            path="/admin/*"
            element={
              <AdminApp
                authClient={authClient}
                apiClient={{} as unknown as AdminApiClient}
                serviceName="kobITo Support"
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows the service name with a 管理 badge and no side menu", async () => {
    loginSetup();
    expect(
      await screen.findByRole("heading", { name: "管理者ログイン" }),
    ).toBeTruthy();
    expect(screen.getByText("管理")).toBeTruthy();
    expect(screen.getByText("kobITo Support")).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "管理メニュー" }),
    ).toBeNull();
  });

  it("asks for the 6-digit code with the mock wording after the password step", async () => {
    loginSetup();
    fireEvent.change(await screen.findByLabelText("メールアドレス"), {
      target: { value: "a@example.jp" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "pw-pw-pw-pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: "管理画面にログイン" }));
    expect(
      await screen.findByRole("heading", { name: "確認コードを入力" }),
    ).toBeTruthy();
    expect(
      screen.getByText("認証アプリに表示されている6桁の数字を入れてください。"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy();
  });
});

describe("a03 customers", () => {
  it("lists customers in a table with plan prices split into 税抜 and 税込", async () => {
    setup("/admin/customers");
    expect(
      await screen.findByRole("heading", { level: 1, name: "顧客" }),
    ).toBeTruthy();
    const table = await screen.findByRole("table", { name: "顧客一覧" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      "店名",
      "状態",
      "プラン",
      "支払方法",
      "申込み",
      "",
    ]);
    const review = within(table).getByRole("link", { name: "審査する" });
    expect(review.getAttribute("href")).toBe(`/admin/customers/${customerId}`);
    expect(within(table).getByRole("link", { name: "開く" })).toBeTruthy();
    expect(table.textContent).toContain("5,000円（税抜）");
    expect(table.textContent).toContain("5,500円（税込）");
  });

  it("filters by status with chips and starts from すべて", async () => {
    const { apiClient } = setup("/admin/customers");
    await screen.findByRole("table", { name: "顧客一覧" });
    expect(apiClient.getApplications).toHaveBeenLastCalledWith({
      q: "",
      page: 1,
      pageSize: 25,
    });
    const chips = screen.getByRole("group", { name: "状態で絞り込む" });
    expect(
      within(chips)
        .getByRole("button", { name: "すべて" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(within(chips).getByRole("button", { name: "利用中" }));
    await waitFor(() =>
      expect(apiClient.getApplications).toHaveBeenLastCalledWith({
        status: "active",
        q: "",
        page: 1,
        pageSize: 25,
      }),
    );
    for (const label of ["審査待ち", "入金待ち", "解約予定", "終了", "失効"]) {
      expect(within(chips).getByRole("button", { name: label })).toBeTruthy();
    }
    expect(
      within(chips).queryByRole("button", { name: /LINE|コンビニ/ }),
    ).toBeNull();
  });
});

describe("a04 customer detail (審査)", () => {
  it("puts the shop name in the heading and the 審査 panel with the two actions", async () => {
    setup(`/admin/customers/${customerId}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: /美容室ルーチェ/ }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("heading", { name: "この申込みの審査" }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "審査完了・請求書を送る" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "承諾しない" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^申込み内容/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "同意の記録" })).toBeTruthy();
    // 税抜と税込を並べて見せる
    expect(document.body.textContent).toContain("5,000円（税抜）");
    expect(document.body.textContent).toContain("5,500円（税込）");
    expect(document.body.textContent).not.toMatch(/承認|LINE|コンビニ/);
  });
});

describe("a05 requests", () => {
  it("lists requests in a table with status chips", async () => {
    setup("/admin/requests");
    expect(
      await screen.findByRole("heading", { level: 1, name: "依頼" }),
    ).toBeTruthy();
    const table = await screen.findByRole("table", { name: "依頼一覧" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["受付", "内容", "状態", "C", "目安"]);
    expect(within(table).getByText("年末年始の休業のお知らせ")).toBeTruthy();
    const chips = screen.getByRole("group", { name: "状態で絞り込む" });
    fireEvent.click(within(chips).getByRole("button", { name: "作業中" }));
    expect(within(table).queryByText("年末年始の休業のお知らせ")).toBeNull();
    expect(within(table).getByText("メニュー表の差し替え")).toBeTruthy();
    expect(screen.getByRole("link", { name: "依頼を記録する" })).toBeTruthy();
  });

  it("marks 作業内容 and 完了の状態 as required in the estimate form", async () => {
    setup(`/admin/requests/${requestId}`);
    const panel = await screen.findByRole("heading", { name: "見積を作る" });
    expect(panel).toBeTruthy();
    const work = screen.getByLabelText(/^作業内容/);
    const done = screen.getByLabelText(/^完了の状態/);
    expect(work.closest(".ui-field")?.textContent).toContain("必須");
    expect(done.closest(".ui-field")?.textContent).toContain("必須");
    expect(
      screen.getByRole("button", { name: "見積を送る（メールで通知）" }),
    ).toBeTruthy();
  });
});

describe("a06 bank transfers", () => {
  it("shows a table with 税抜小計・消費税・税込合計 and the 入金額 must equal 税込合計", async () => {
    setup("/admin/bank-transfers");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "銀行振込の入金確認",
      }),
    ).toBeTruthy();
    const table = await screen.findByRole("table", {
      name: "入金待ちの請求書",
    });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["請求書", "店名", "金額", "期限", ""]);
    expect(table.textContent).toContain("税抜小計 10,000円");
    expect(table.textContent).toContain("消費税 1,000円");
    expect(table.textContent).toContain("税込合計 11,000円");
    fireEvent.click(within(table).getByRole("button", { name: "入金あり" }));
    const amount = await screen.findByLabelText(/^入金額/);
    expect(document.body.textContent).toContain(
      "入金額は税込合計 11,000円 と同じ金額を入力します",
    );
    fireEvent.change(amount, { target: { value: "10000" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.change(amount, { target: { value: "11000" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a07 invoices", () => {
  it("lists invoices in a table, splits the amounts and filters by 状態", async () => {
    setup("/admin/invoices");
    expect(
      await screen.findByRole("heading", { level: 1, name: "請求書" }),
    ).toBeTruthy();
    const table = await screen.findByRole("table", { name: "請求書一覧" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["番号", "発行日", "金額（税込）", "方法", "状態", ""]);
    expect(table.textContent).toContain("11,000");
    expect(table.textContent).toContain("税抜 10,000円 ＋ 消費税 1,000円");
    expect(table.textContent).not.toContain("コンビニ");
    const chips = screen.getByRole("group", { name: "状態で絞り込む" });
    fireEvent.click(within(chips).getByRole("button", { name: "支払い済み" }));
    expect(within(table).queryByText("SP-2026-0080")).toBeNull();
    expect(within(table).getByText("SP-2026-0058")).toBeTruthy();
  });

  it("shows 税抜小計・消費税・税込合計 on the detail", async () => {
    setup(`/admin/invoices/${invoiceId}`, {
      getInvoice: vi.fn(async () => ({
        ...invoice,
        acceptedPlan: {
          planId: "55555555-5555-4555-8555-555555555555",
          planCode: "light",
          planName: "スタンダード",
          monthlyPriceExclTax: 10000,
          credits: 3,
        },
        billingName: "そろばん教室 みらい",
        billingAddress: "東京都1-1",
        issuer: {
          serviceName: "kobITo Support",
          companyName: "運営会社",
          companyAddress: "東京都千代田区1-1",
          invoiceRegistrationNo: null,
          bankAccountName: null,
          bankAccountBranch: null,
          bankAccountType: null,
          bankAccountNumber: null,
        },
        lines: [
          {
            description: "スタンダード 初月分",
            quantity: 1,
            unitPriceExclTax: 10000,
            amountExclTax: 10000,
            taxRate: 0.1,
          },
        ],
      })),
    });
    expect(await screen.findByText("税抜小計")).toBeTruthy();
    expect(screen.getByText("消費税（10%）")).toBeTruthy();
    expect(screen.getByText("税込合計")).toBeTruthy();
    expect(screen.getByText("11,000円")).toBeTruthy();
  });
});

describe("settings", () => {
  it("renders inside the admin shell with the 設定 item current", async () => {
    setup("/admin/settings");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "発行者・振込先設定",
      }),
    ).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "管理メニュー" });
    expect(
      within(nav)
        .getByRole("link", { name: "設定" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});
