// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import type { AdminAuthClient } from "../auth/admin-session.js";
import type { AuthClient, AuthUser } from "../auth/session.js";
import type { AdminApiClient } from "../platform/admin-api-client.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";

const contractId = "11111111-1111-4111-8111-111111111111";
const requestId = "33333333-3333-4333-8333-333333333333";
const estimateId = "44444444-4444-4444-8444-444444444444";
const invoiceId = "66666666-6666-4666-8666-666666666666";

const estimate = {
  id: estimateId,
  requestId,
  version: 1,
  credits: 1,
  dueOn: "2026-11-20",
  workItems: ["メニューページを差し替える", "Googleマップを更新する"],
  doneCriteria: "新しいメニューと価格が表示されている状態です。",
  exclusions: "新しい写真の撮影",
  customerPrep: "品名と価格の最終確認",
  sentAt: "2026-11-09T15:30:00.000Z",
  approvedAt: null,
  supersededAt: null,
};
const awaiting = {
  id: requestId,
  contractId,
  receivedOn: "2026-11-10",
  summary: "メニュー表の差し替え",
  urgent: false,
  status: "awaiting_approval" as const,
  createdAt: "2026-11-10T00:00:00.000Z",
  latestEstimate: estimate,
  completion: null,
  approvedEstimateId: null,
};
const working = {
  ...awaiting,
  id: "77777777-7777-4777-8777-777777777777",
  summary: "Googleマップの営業時間の更新",
  receivedOn: "2026-11-08",
  status: "in_progress" as const,
  latestEstimate: { ...estimate, credits: 1, dueOn: "2026-11-14" },
  approvedEstimateId: estimateId,
};
const done = {
  ...awaiting,
  id: "88888888-8888-4888-8888-888888888888",
  summary: "Instagramのプロフィール整え",
  status: "done" as const,
  completion: {
    completedOn: "2026-11-04",
    actualMinutes: 45,
    actualCredits: 1,
    reservedCredits: 1,
    periodId: "55555555-5555-4555-8555-555555555555",
    reservedPeriod: { startsOn: "2026-10-26", endsOn: "2026-11-25" },
  },
};

const activeContract = {
  contract: {
    id: contractId,
    status: "active" as const,
    anchorDate: "2026-10-26",
    preview: false,
    plan: { name: "スタンダード", priceExclTax: 10000, credits: 3 },
    currentPeriod: {
      id: "55555555-5555-4555-8555-555555555555",
      seq: 1,
      startsOn: "2026-10-26",
      endsOn: "2026-11-25",
      priceExclTax: 10000,
      credits: 3,
      balance: 1,
    },
  },
};

const invoiceItem = {
  id: invoiceId,
  invoiceNo: "SP-2026-0042",
  kind: "initial" as const,
  status: "issued" as const,
  issuedOn: "2026-10-26",
  dueOn: "2026-11-02",
  totalInclTax: 11000,
  totalExclTax: 10000,
  taxAmount: 1000,
  paymentMethod: "bank_transfer" as const,
  preview: false,
};
const invoiceDetail = {
  ...invoiceItem,
  acceptedPlan: {
    planId: "55555555-5555-4555-8555-555555555555",
    planCode: "standard",
    planName: "スタンダード",
    monthlyPriceExclTax: 10000,
    credits: 3,
  },
  billingName: "喫茶ひだまり",
  billingAddress: "東京都杉並区1-2-3",
  issuer: {
    serviceName: "Small Plus",
    companyName: "合同会社シングラータ",
    companyAddress: "東京都千代田区1-1",
    invoiceRegistrationNo: null,
    bankAccountName: "ゴウドウガイシャ シングラータ",
    bankAccountBranch: "〇〇支店",
    bankAccountType: "普通",
    bankAccountNumber: "1234567",
  },
  lines: [
    {
      description: "スタンダードプラン 初月分",
      quantity: 1,
      unitPriceExclTax: 10000,
      amountExclTax: 10000,
      taxRate: 0.1,
    },
  ],
};

const activeAccess = {
  contractStatus: "active",
  landingPath: "/me",
  access: "active",
  welcomeRequired: false,
  invoiceAccess: true,
  invoiceAccessUntil: null,
};
function pendingAccess(contractStatus: string) {
  return {
    contractStatus,
    landingPath: "/me/waiting",
    access: "pending",
    welcomeRequired: false,
    invoiceAccess: true,
    invoiceAccessUntil: null,
  };
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

function setup(
  path: string,
  customer: Record<string, unknown> = {},
  appProps: { lineEnabled?: boolean } = {},
) {
  window.history.replaceState({}, "", path);
  const user: AuthUser = {
    uid: "customer-a",
    email: "hidamari@example.jp",
    getIdToken: vi.fn(async () => "id-token"),
  };
  let currentUser: AuthUser | null = user;
  let listener: ((next: AuthUser | null) => void) | null = null;
  const authClient: AuthClient = {
    currentUser: () => currentUser,
    subscribe: (next) => {
      listener = next;
      queueMicrotask(() => next(currentUser));
      return () => undefined;
    },
    signIn: vi.fn(async () => user),
    signInWithCustomToken: vi.fn(async () => user),
    sendPasswordReset: async () => undefined,
    signUp: vi.fn(async () => user),
    signOut: vi.fn(async () => {
      currentUser = null;
      listener?.(null);
    }),
  };
  const adminAuthClient = {
    currentUser: () => user,
    subscribe: (next: (u: AuthUser | null) => void) => {
      queueMicrotask(() => next(user));
      return () => undefined;
    },
  } as unknown as AdminAuthClient;
  const apiClient = {
    getPublicConfig: vi.fn(async () => ({
      serviceName: "Small Plus",
      contactEmail: "info@cingulata.jp",
    })),
    getMe: vi.fn(async () => ({
      customer: {
        id: "22222222-2222-4222-8222-222222222222",
        shopName: "喫茶ひだまり",
        contactName: "山田 花子",
      },
    })),
    getContract: vi.fn(async () => activeContract),
    getCustomerRequests: vi.fn(async () => ({
      items: [awaiting, working, done],
    })),
    getCustomerRequest: vi.fn(async () => ({
      request: awaiting,
      latestEstimate: estimate,
      currentPeriodId: "55555555-5555-4555-8555-555555555555",
      availableCredits: 2,
      canApprove: true,
    })),
    approveEstimate: vi.fn(),
    getCustomerAccess: vi.fn(async () => activeAccess),
    markWelcomeSeen: vi.fn(async () => ({
      seenAt: "2026-10-27T00:00:00.000Z",
    })),
    getInvoices: vi.fn(async () => ({ invoices: [invoiceItem] })),
    getInvoice: vi.fn(async () => invoiceDetail),
    getInvoicePdf: vi.fn(),
    ...customer,
  } as unknown as ReturnTypeApiClient;
  render(
    <App
      apiClient={apiClient}
      authClient={authClient}
      adminApiClient={{} as unknown as AdminApiClient}
      adminAuthClient={adminAuthClient}
      {...appProps}
    />,
  );
  return { apiClient, authClient };
}

function text() {
  return document.body.textContent ?? "";
}

describe("c04 waiting page", () => {
  it("under review says 審査 and does not load invoices", async () => {
    const { apiClient } = setup("/me/waiting", {
      getCustomerAccess: vi.fn(async () => pendingAccess("under_review")),
    });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "審査をしています",
      }),
    ).toBeTruthy();
    expect(text()).toContain("審査が終わりましたら");
    expect(document.querySelector("[aria-current='step']")?.textContent).toBe(
      "お申込み",
    );
    expect(apiClient.getInvoices).not.toHaveBeenCalled();
    expect(text()).not.toContain("確認しています");
  });

  it("awaiting payment shows tax-exclusive subtotal, tax, total and bank details", async () => {
    setup("/me/waiting", {
      getCustomerAccess: vi.fn(async () => pendingAccess("awaiting_payment")),
    });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "初月分のお支払い",
      }),
    ).toBeTruthy();
    const card = (await screen.findByText(/SP-2026-0042/)).closest("section");
    expect(card).toBeTruthy();
    const body = card?.textContent ?? "";
    expect(body).toContain("小計（税抜）10,000円");
    expect(body).toContain("消費税（10%）1,000円");
    expect(body).toContain("ご請求額（税込）11,000円");
    expect(body).toContain("お支払い期限：2026年11月2日");
    expect(body).toContain("ゴウドウガイシャ シングラータ");
    expect(body).toContain("1234567");
    expect(document.querySelector("[aria-current='step']")?.textContent).toBe(
      "お支払い",
    );
    expect(text()).not.toContain("コンビニ");
    expect(text()).not.toContain("LINE");
    expect(
      screen
        .getByRole("link", { name: "info@cingulata.jp" })
        .getAttribute("href"),
    ).toBe("mailto:info@cingulata.jp");
  });

  it("card invoices show a hosted payment link without accepting card details", async () => {
    setup("/me/waiting", {
      getCustomerAccess: vi.fn(async () => pendingAccess("awaiting_payment")),
      getInvoices: vi.fn(async () => ({
        invoices: [{ ...invoiceItem, paymentMethod: "card" as const }],
      })),
    });
    expect(await screen.findByText(/クレジットカードで支払う/)).toBeTruthy();
    expect(text()).toContain("KOMOJUのお支払い画面");
    expect(
      screen.getByRole("button", { name: "お支払いページへ進む" }),
    ).toBeTruthy();
    expect(document.querySelectorAll("input").length).toBe(0);
    expect(screen.queryByText("ゴウドウガイシャ シングラータ")).toBeNull();
  });

  it("declined applications get a closing page without business data", async () => {
    setup("/me/finished", {
      getCustomerAccess: vi.fn(async () => ({
        contractStatus: "declined",
        landingPath: "/me/finished",
        access: "finished",
        welcomeRequired: false,
        invoiceAccess: false,
        invoiceAccessUntil: null,
      })),
    });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "お申込みは終了しました",
      }),
    ).toBeTruthy();
    expect(text()).toContain("今回はご契約をお受けできませんでした");
  });

  it("lapsed applications explain the expired payment period", async () => {
    setup("/me/finished", {
      getCustomerAccess: vi.fn(async () => ({
        contractStatus: "lapsed",
        landingPath: "/me/finished",
        access: "finished",
        welcomeRequired: false,
        invoiceAccess: false,
        invoiceAccessUntil: null,
      })),
    });
    expect(await screen.findByText(/期限を過ぎた/)).toBeTruthy();
  });
});

describe("c05 welcome page", () => {
  const welcome = {
    ...activeAccess,
    landingPath: "/me/welcome",
    welcomeRequired: true,
  };
  it("shows credits, the flow by email and the next grant date", async () => {
    setup("/me/welcome", { getCustomerAccess: vi.fn(async () => welcome) });
    expect(
      await screen.findByText("今月の3クレジットが使えます。", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(text()).toContain("メールで「〇〇したい」と送る");
    expect(text()).toContain("見積（使うクレジットと目安日）がメールで届く");
    expect(text()).toContain("次は11月26日");
    expect(text()).toContain("繰り越しはありません");
    expect(text()).not.toContain("LINE");
    expect(
      screen.getByRole("button", { name: "マイページを見る" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "info@cingulata.jp" })
        .getAttribute("href"),
    ).toBe("mailto:info@cingulata.jp");
  });

  it("falls back to a general line when the contract cannot be read", async () => {
    setup("/me/welcome", {
      getCustomerAccess: vi.fn(async () => welcome),
      getContract: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    expect(await screen.findByText(/お支払いを確認しました/)).toBeTruthy();
    expect(text()).not.toContain("今月の");
  });
});

describe("c07 home", () => {
  it("shows remaining credits, period end, running requests and the next bill", async () => {
    setup("/me");
    expect(await screen.findByText("今月のクレジット")).toBeTruthy();
    const credit = screen.getByText("今月のクレジット").closest("section");
    expect(credit?.textContent).toContain("1");
    expect(credit?.textContent).toContain("残り / 3");
    expect(credit?.textContent).toContain("使える期限11月25日");
    expect(credit?.textContent).toContain("繰り越されません");
    const next = screen.getByText("次のお支払い").closest("section");
    expect(next?.textContent).toContain("11月26日");
    expect(next?.textContent).toContain("11,000円");
    expect(next?.textContent).toContain("税抜10,000円");
    expect(next?.textContent).toContain("消費税1,000円");
  });

  it("puts a pending estimate on top and lists only running requests", async () => {
    setup("/me");
    const link = await screen.findByRole("link", { name: "見る" });
    expect(link.getAttribute("href")).toBe(
      `/me/requests/${requestId}/estimate`,
    );
    expect(text()).toContain("見積が届いています");
    const list = screen.getByText("ご依頼の状況").closest("section");
    expect(list?.textContent).toContain("Googleマップの営業時間の更新");
    expect(list?.textContent).toContain("作業中");
    expect(list?.textContent).not.toContain("Instagramのプロフィール整え");
  });

  it("offers mail contact and the four tabs, without LINE", async () => {
    setup("/me");
    const mail = await screen.findByRole("link", {
      name: "メールで相談・依頼する",
    });
    expect(mail.getAttribute("href")).toBe("mailto:info@cingulata.jp");
    const nav = screen.getByRole("navigation", { name: "メニュー" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["⌂ホーム", "☰依頼", "¥請求", "◎契約"]);
    expect(text()).not.toContain("LINE");
  });

  it("does not show a next bill for a scheduled cancellation", async () => {
    setup("/me", {
      getContract: vi.fn(async () => ({
        contract: { ...activeContract.contract, status: "cancel_scheduled" },
      })),
    });
    await screen.findByText("今月のクレジット");
    expect(text()).toContain("11月25日で終了");
    expect(text()).not.toContain("11,000円");
  });
});

describe("c08 requests", () => {
  it("groups by progress, shows state badges and filters", async () => {
    setup("/me/requests");
    expect(
      await screen.findByRole("heading", { level: 1, name: "ご依頼の状況" }),
    ).toBeTruthy();
    const progress = (
      await screen.findByRole("heading", { name: "進行中" })
    ).closest("section");
    expect(progress?.textContent).toContain("了承待ち");
    expect(progress?.textContent).toContain("作業中");
    const doneCard = screen
      .getByRole("heading", { name: "完了" })
      .closest("section");
    expect(doneCard?.textContent).toContain("1クレジット使用");
    expect(doneCard?.textContent).toContain("11/4 完了");
    expect(text()).not.toContain("実作業時間");
    expect(
      screen
        .getByRole("link", { name: /メニュー表の差し替え/ })
        .getAttribute("href"),
    ).toBe(`/me/requests/${requestId}/estimate`);
    fireEvent.click(screen.getByRole("button", { name: "完了" }));
    expect(screen.queryByText("メニュー表の差し替え")).toBeNull();
    expect(screen.getByText("Instagramのプロフィール整え")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "完了" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("c09 estimate", () => {
  it("shows work, exclusions, preparation, credits, target date and the remaining change", async () => {
    setup(`/me/requests/${requestId}/estimate`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "見積のご確認" }),
    ).toBeTruthy();
    expect(text()).toContain("メニューページを差し替える");
    expect(text()).toContain("含まれないもの");
    expect(text()).toContain("新しい写真の撮影");
    expect(text()).toContain("ご用意いただくもの");
    expect(text()).toContain("使うクレジット1");
    expect(text()).toContain("完了の目安11/20");
    expect(text()).toContain("残りは 2 → 1 になります");
    expect(text()).toContain("押すまで作業は始まらず、クレジットも使いません");
    expect(screen.getByRole("button", { name: "了承する" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "メールで相談する" })
        .getAttribute("href"),
    ).toContain("mailto:info@cingulata.jp");
    expect(text()).not.toContain("断る");
  });

  it("explains the shortage and disables approval", async () => {
    setup(`/me/requests/${requestId}/estimate`, {
      getCustomerRequest: vi.fn(async () => ({
        request: awaiting,
        latestEstimate: estimate,
        currentPeriodId: null,
        availableCredits: 0,
        canApprove: false,
      })),
    });
    expect(await screen.findByText("クレジットが1つ足りません")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "了承する" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByRole("link", { name: "メールで相談する" })).toBeTruthy();
  });

  it("asks for confirmation before approving", async () => {
    const approveEstimate = vi.fn(async () => ({
      requestId,
      estimateId,
      status: "in_progress" as const,
      approvedAt: "2026-11-10T01:00:00.000Z",
      reservedCredits: 1,
      replayed: false,
    }));
    setup(`/me/requests/${requestId}/estimate`, { approveEstimate });
    fireEvent.click(await screen.findByRole("button", { name: "了承する" }));
    const dialog = await screen.findByRole("dialog");
    expect(approveEstimate).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "了承する" }));
    await waitFor(() =>
      expect(approveEstimate).toHaveBeenCalledWith(estimateId),
    );
  });
});

describe("c10 invoices", () => {
  it("shows the unpaid invoice with subtotal, tax and total plus bank details", async () => {
    setup("/me/invoices");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "請求書とお支払い",
      }),
    ).toBeTruthy();
    const card = (await screen.findByText(/SP-2026-0042/)).closest("section");
    const body = card?.textContent ?? "";
    expect(body).toContain("小計（税抜）10,000円");
    expect(body).toContain("消費税（10%）1,000円");
    expect(body).toContain("合計（税込）11,000円");
    expect(body).toContain("お支払い期限：2026年11月2日");
    expect(body).toContain("1234567");
    expect(text()).not.toContain("コンビニ");
  });

  it("warns when a card payment failed and shows guidance without a link", async () => {
    setup("/me/invoices", {
      getInvoices: vi.fn(async () => ({
        invoices: [
          {
            ...invoiceItem,
            status: "failed" as const,
            paymentMethod: "card" as const,
          },
        ],
      })),
    });
    expect(
      await screen.findByText("カードでのお支払いができませんでした"),
    ).toBeTruthy();
    expect(text()).toContain("カードでのお支払いをご案内できません");
    expect(
      screen.queryByRole("button", { name: "お支払いページへ進む" }),
    ).toBeNull();
    expect(document.querySelectorAll("input").length).toBe(0);
  });

  it("lists paid invoices under これまでの請求書", async () => {
    setup("/me/invoices", {
      getInvoices: vi.fn(async () => ({
        invoices: [{ ...invoiceItem, status: "paid" as const }],
      })),
    });
    const card = (await screen.findByText("これまでの請求書")).closest(
      "section",
    );
    expect(card?.textContent).toContain("支払い済み");
    expect(card?.textContent).toContain("11,000円");
    expect(
      within(card as HTMLElement)
        .getByRole("link")
        .getAttribute("href"),
    ).toBe(`/me/invoices/${invoiceId}`);
  });

  it("detail shows the exclusive subtotal, tax and inclusive total in yen", async () => {
    setup(`/me/invoices/${invoiceId}`);
    await screen.findByText("スタンダードプラン 初月分");
    expect(text()).toContain("小計（税抜）10,000円");
    expect(text()).toContain("消費税（10%）1,000円");
    expect(text()).toContain("合計（税込）11,000円");
  });
});

describe("c11 contract", () => {
  it("shows the tax-exclusive price first, dates and next billing date", async () => {
    setup("/me/contract");
    expect(
      await screen.findByRole("heading", { level: 1, name: "ご契約内容" }),
    ).toBeTruthy();
    const plan = (await screen.findByText("スタンダード")).closest("section");
    const body = plan?.textContent ?? "";
    expect(body).toContain("月額（税抜）10,000円");
    expect(body).toContain("月額（税込）11,000円");
    expect(body).toContain("毎月のクレジット3");
    expect(body).toContain("契約日2026年10月26日");
    expect(body).toContain("現在の期間2026年10月26日〜2026年11月25日");
    expect(body).toContain("次の請求日2026年11月26日");
    expect(text()).not.toContain("LINE");
  });

  it("guides changes by mail and shows the login email with logout", async () => {
    const { authClient } = setup("/me/contract");
    await screen.findByText("プランの変更・追加・解約");
    expect(
      screen
        .getByRole("link", { name: "メールで連絡する" })
        .getAttribute("href"),
    ).toBe("mailto:info@cingulata.jp");
    expect(text()).toContain("hidamari@example.jp");
    expect(text()).toContain("11月25日");
    expect(text()).toContain("日割りはしません");
    fireEvent.click(screen.getByRole("button", { name: "ログアウト" }));
    await waitFor(() => expect(authClient.signOut).toHaveBeenCalled());
  });
});
