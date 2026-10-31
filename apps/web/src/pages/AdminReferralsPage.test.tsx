// @vitest-environment jsdom
// 管理画面 a08 紹介・報酬（閲覧のみ）。基準は税抜、支払いは報酬（税抜）＋消費税。

import type { AdminReferralsResponse } from "@kobito/shared";
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
import { type AdminApiClient, AdminApp } from "./AdminApp.js";

const amounts = (count: number, base: number, reward: number, tax: number) => ({
  count,
  baseAmount: base,
  rewardAmount: reward,
  taxAmount: tax,
  payableAmount: reward + tax,
});
const line = (over: Record<string, unknown>) => ({
  rewardId: "r",
  shopName: "喫茶ひだまり",
  rewardType: "closing" as const,
  ratePercent: 20,
  monthIndex: 1,
  maxMonths: 12,
  baseAmount: 5000,
  rewardAmount: 1000,
  taxAmount: 100,
  payableAmount: 1100,
  status: "unpaid" as const,
  paidOn: null,
  ...over,
});
const report: AdminReferralsResponse = {
  month: "2026-11",
  partners: [
    {
      partnerId: "p1",
      partnerName: "佐藤さん",
      referralCode: "SP-0012",
      rows: [
        line({ rewardId: "a" }),
        line({
          rewardId: "b",
          shopName: "カフェ あおば",
          monthIndex: 5,
          baseAmount: 15000,
          rewardAmount: 3000,
          taxAmount: 300,
          payableAmount: 3300,
        }),
      ],
      subtotal: amounts(2, 20000, 4000, 400),
    },
    {
      partnerId: "p2",
      partnerName: "伊藤さん",
      referralCode: "SP-0003",
      rows: [
        line({
          rewardId: "c",
          shopName: "整体院 こはる",
          rewardType: "appointment",
          ratePercent: 10,
          baseAmount: 5000,
          rewardAmount: 500,
          taxAmount: 50,
          payableAmount: 550,
          status: "paid",
          paidOn: "2026-12-05",
        }),
      ],
      subtotal: amounts(1, 5000, 500, 50),
    },
  ],
  total: amounts(3, 25000, 4500, 450),
};

function setup(
  getAdminReferrals: (month?: string) => Promise<AdminReferralsResponse>,
) {
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
  const apiClient = {
    getSession: vi.fn(async () => ({ role: "admin" as const })),
    getAdminReferrals: vi.fn(getAdminReferrals),
  } as unknown as AdminApiClient;
  render(
    <MemoryRouter initialEntries={["/admin/referrals"]}>
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
  return apiClient as unknown as {
    getAdminReferrals: ReturnType<typeof vi.fn>;
  };
}

afterEach(cleanup);

describe("a08 referrals and rewards", () => {
  it("lists rewards per partner on a tax-exclusive base with reward + tax = payable", async () => {
    setup(async () => report);
    expect(
      await screen.findByRole("heading", { name: "紹介・報酬" }),
    ).toBeTruthy();
    expect(await screen.findByText("2026年11月")).toBeTruthy();
    const table = await screen.findByRole("table", { name: /佐藤さん/ });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual([
      "店名",
      "種類",
      "基準額（税抜）",
      "報酬（税抜）",
      "消費税",
      "支払い額",
      "経過",
      "支払い",
    ]);
    const shop = within(table).getByText("喫茶ひだまり").closest("tr");
    if (!shop) throw new Error("row missing");
    const cells = within(shop)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells).toEqual([
      "喫茶ひだまり",
      "成約 20%",
      "5,000円",
      "1,000円",
      "100円",
      "1,100円",
      "1 / 12か月",
      "未払い",
    ]);
    // パートナーごとの小計
    const subtotal = within(table).getByText("小計").closest("tr");
    if (!subtotal) throw new Error("subtotal missing");
    expect(subtotal.textContent).toContain("20,000円");
    expect(subtotal.textContent).toContain("4,400円");
    // 別パートナー：アポ10%・支払い済み
    const other = await screen.findByRole("table", { name: /伊藤さん/ });
    expect(within(other).getByText("アポ 10%")).toBeTruthy();
    expect(within(other).getByText(/支払い済み/)).toBeTruthy();
    // 月の合計
    const total = screen.getByRole("region", { name: "月の合計" });
    expect(within(total).getByText("4,950円")).toBeTruthy();
    expect(within(total).getByText("4,500円")).toBeTruthy();
    expect(screen.queryByText(/税込/)).toBeNull();
    expect(screen.queryByText(/LINE|コンビニ/)).toBeNull();
  });

  it("shows the empty state when there are no rewards", async () => {
    setup(async () => ({
      month: "2026-11",
      partners: [],
      total: amounts(0, 0, 0, 0),
    }));
    expect(await screen.findByText("該当する報酬はありません")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("switches the month with previous / next buttons", async () => {
    const api = setup(async (month) => ({
      ...report,
      month: month ?? "2026-11",
    }));
    await screen.findByText("2026年11月");
    fireEvent.click(screen.getByRole("button", { name: "前の月" }));
    await waitFor(() =>
      expect(api.getAdminReferrals).toHaveBeenLastCalledWith("2026-10"),
    );
    expect(await screen.findByText("2026年10月")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "次の月" }));
    await waitFor(() =>
      expect(api.getAdminReferrals).toHaveBeenLastCalledWith("2026-11"),
    );
  });

  it("offers a retry when loading fails", async () => {
    setup(() => Promise.reject(new Error("x")));
    expect(
      await screen.findByText("紹介・報酬を読み込めませんでした。"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeTruthy();
  });
});
