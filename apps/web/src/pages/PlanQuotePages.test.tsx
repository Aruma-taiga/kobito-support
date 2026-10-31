// @vitest-environment jsdom

import { webMessages } from "@kobito/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import type { AdminAuthClient } from "../auth/admin-session.js";
import type { AuthClient, AuthUser } from "../auth/session.js";
import type { AdminApiClient } from "../platform/admin-api-client.js";
import {
  ApiClientError,
  type ReturnTypeApiClient,
} from "../platform/api-client.js";

const quoteId = "11111111-1111-4111-8111-111111111111";
const quote = {
  id: quoteId,
  version: 1,
  priceExclTax: 12_345,
  taxAmount: 1_234,
  priceInclTax: 13_579,
  credits: 8,
  description:
    "ホームページの更新（月2回まで）\nキャッシュレス決済の設定の相談\n\n毎月1回の定例の相談",
  expiresOn: "2026-11-28",
  sentAt: "2026-11-13T15:30:00.000Z",
  approvedAt: null,
  status: "awaiting" as const,
  canApprove: true,
};
const pending = (contractStatus: string, landingPath = "/me/waiting") => ({
  contractStatus,
  landingPath,
  access: "pending",
  welcomeRequired: false,
  invoiceAccess: contractStatus !== "awaiting_quote_approval",
  invoiceAccessUntil: null,
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

function setup(overrides: Record<string, unknown> = {}) {
  window.history.replaceState({}, "", "/me/plan-quote");
  const user: AuthUser = {
    uid: "customer-a",
    email: "aoba@example.jp",
    getIdToken: vi.fn(async () => "id-token"),
  };
  const authClient: AuthClient = {
    currentUser: () => user,
    subscribe: (next) => {
      queueMicrotask(() => next(user));
      return () => undefined;
    },
    signIn: vi.fn(async () => user),
    signInWithCustomToken: vi.fn(async () => user),
    sendPasswordReset: async () => undefined,
    signUp: vi.fn(async () => user),
    signOut: vi.fn(async () => undefined),
  };
  const access = vi.fn(async () =>
    pending("awaiting_quote_approval", "/me/plan-quote"),
  );
  const apiClient = {
    getPublicConfig: vi.fn(async () => ({
      serviceName: "Small Plus",
      contactEmail: "info@cingulata.jp",
    })),
    getCustomerAccess: access,
    getPlanQuote: vi.fn(async () => quote),
    approvePlanQuote: vi.fn(async () => ({
      quoteId,
      approvedAt: "2026-11-14T03:00:00.000Z",
      contractStatus: "awaiting_payment" as const,
      replayed: false,
    })),
    getInvoices: vi.fn(async () => ({ invoices: [] })),
    getInvoice: vi.fn(),
    ...overrides,
  } as unknown as ReturnTypeApiClient;
  render(
    <App
      apiClient={apiClient}
      authClient={authClient}
      adminApiClient={{} as unknown as AdminApiClient}
      adminAuthClient={{} as unknown as AdminAuthClient}
    />,
  );
  return { apiClient, access };
}
const text = () => document.body.textContent ?? "";

describe("c12 plan quote page", () => {
  it("shows the tax-exclusive monthly price first with the tax-inclusive amount beside it", async () => {
    setup();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: webMessages.planQuoteTitle,
      }),
    ).toBeTruthy();
    const body = text();
    expect(body).toContain("月額（税抜）");
    expect(body).toContain("12,345円");
    expect(body).toContain("税込 13,579円（消費税 1,234円）");
    expect(body).toContain("毎月のクレジット");
    expect(body).toContain("審査が完了しました");
    expect(body).toContain("了承待ち");
    expect(body).toContain("見積りの有効期限：2026年11月28日まで");
    expect(body).toContain("お見積りの送付：2026年11月14日");
    // 内容は1行ごとの項目になり、空行は無視される
    const items = [...document.querySelectorAll(".ui-block ol li")].map(
      (item) => item.textContent,
    );
    expect(items).toEqual([
      "ホームページの更新（月2回まで）",
      "キャッシュレス決済の設定の相談",
      "毎月1回の定例の相談",
    ]);
    expect(document.querySelector("[aria-current='step']")?.textContent).toBe(
      "見積り",
    );
  });

  it("uses 審査 wording and shows no tech terms, convenience stores, LINE or card entry", async () => {
    setup();
    await screen.findByRole("button", { name: "この内容で申し込む" });
    const body = text();
    expect(body).toContain("審査");
    for (const banned of ["コンビニ", "LINE", "API", "plan_quote", "工数"]) {
      expect(body).not.toContain(banned);
    }
    expect(document.querySelectorAll("input").length).toBe(0);
    expect(
      screen
        .getByRole("link", { name: webMessages.planQuoteConsult })
        .getAttribute("href"),
    ).toContain("mailto:info@cingulata.jp");
  });

  it("approves once, then goes to the waiting page where the invoice is shown", async () => {
    const { apiClient, access } = setup();
    const approve = await screen.findByRole("button", {
      name: "この内容で申し込む",
    });
    access.mockImplementation(async () => pending("awaiting_payment"));
    fireEvent.click(approve);
    fireEvent.click(approve);
    await waitFor(() => expect(window.location.pathname).toBe("/me/waiting"));
    await waitFor(() =>
      expect(apiClient.approvePlanQuote).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(apiClient.approvePlanQuote).toHaveBeenCalledWith(quoteId),
    );
  });

  it("explains an expired quote and offers no approval", async () => {
    setup({
      getPlanQuote: vi.fn(async () => ({
        ...quote,
        status: "expired" as const,
        canApprove: false,
      })),
    });
    expect(await screen.findByText("期限切れ")).toBeTruthy();
    expect(text()).toContain(webMessages.planQuoteExpiredNotice);
    expect(
      screen.queryByRole("button", { name: "この内容で申し込む" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: webMessages.planQuoteConsult }),
    ).toBeTruthy();
  });

  it("shows the server's refusal when the quote has changed or expired in the meantime", async () => {
    setup({
      approvePlanQuote: vi.fn(async () => {
        throw new ApiClientError("plan_quote_expired");
      }),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "この内容で申し込む" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.planQuoteExpiredError,
    );
    expect(window.location.pathname).toBe("/me/plan-quote");
    cleanup();
    setup({
      approvePlanQuote: vi.fn(async () => {
        throw new ApiClientError("plan_quote_conflict");
      }),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "この内容で申し込む" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.planQuoteChanged,
    );
  });

  it("offers a retry when the quote cannot be loaded", async () => {
    const getPlanQuote = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError("server"))
      .mockResolvedValue(quote);
    setup({ getPlanQuote });
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.planQuoteLoadError,
    );
    fireEvent.click(screen.getByRole("button", { name: webMessages.retry }));
    expect(
      await screen.findByRole("button", { name: "この内容で申し込む" }),
    ).toBeTruthy();
  });

  it("keeps customers whose contract is not awaiting a quote away from the page", async () => {
    const { apiClient } = setup({
      getCustomerAccess: vi.fn(async () => pending("quoting")),
    });
    await waitFor(() => expect(window.location.pathname).toBe("/me/waiting"));
    expect(apiClient.getPlanQuote).not.toHaveBeenCalled();
  });
});
