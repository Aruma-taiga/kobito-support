// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminAuthClient } from "../auth/admin-session.js";
import { type AdminApiClient, AdminApp } from "./AdminApp.js";

afterEach(cleanup);
function setup(getRetention = vi.fn(async () => [] as unknown[])) {
  const user = { email: "admin@example.jp", getIdToken: async () => "token" };
  const authClient = {
    currentUser: () => user,
    subscribe: (listener: (user: unknown) => void) => {
      queueMicrotask(() => listener(user));
      return () => undefined;
    },
    signOut: vi.fn(),
    signIn: vi.fn(),
    startSecondFactor: vi.fn(),
    completeSecondFactor: vi.fn(),
    cancelSecondFactor: vi.fn(),
  } as unknown as AdminAuthClient;
  const apiClient = {
    getSession: vi.fn(async () => ({ role: "admin" })),
    getRetention,
    getApplications: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })),
  } as unknown as AdminApiClient;
  render(
    <MemoryRouter initialEntries={["/admin/retention"]}>
      <Routes>
        <Route
          path="/admin/*"
          element={<AdminApp authClient={authClient} apiClient={apiClient} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return getRetention;
}
it("lists only shop, state, calendar dates and remaining days after session verification", async () => {
  const get = setup(
    vi.fn(async () => [
      {
        customerId: "11111111-1111-4111-8111-111111111111",
        shopName: "喫茶ひだまり",
        status: "ended",
        baseDate: "2025-11-01",
        dueDate: "2026-11-01",
        daysRemaining: 0,
      },
    ]),
  );
  expect(await screen.findByText("喫茶ひだまり")).toBeTruthy();
  expect(screen.getByText("2025年11月1日")).toBeTruthy();
  expect(screen.getByText("2026年11月1日")).toBeTruthy();
  expect(screen.getByText("0日")).toBeTruthy();
  expect(screen.queryByText("メールアドレス")).toBeNull();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
});
it("shows an empty state", async () => {
  setup();
  expect(await screen.findByText("削除予定の顧客はいません。")).toBeTruthy();
});
it("shows loading and retries a failed request", async () => {
  const get = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([]);
  setup(get);
  expect(
    await screen.findByText("削除予定を読み込めませんでした。"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("削除予定の顧客はいません。")).toBeTruthy();
});

it("keeps loading visible until the list arrives", async () => {
  let resolve: (items: unknown[]) => void = () => undefined;
  setup(
    vi.fn(
      () =>
        new Promise<unknown[]>((done) => {
          resolve = done;
        }),
    ),
  );
  expect(await screen.findByText("削除予定を読み込んでいます。")).toBeTruthy();
  resolve([]);
  expect(await screen.findByText("削除予定の顧客はいません。")).toBeTruthy();
});
