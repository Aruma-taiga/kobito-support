// @vitest-environment jsdom

import { webMessages } from "@kobito/shared";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { type AuthClient, AuthProvider, RequireAuth } from "../auth/session.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";
import { createApiClient } from "../platform/api-client.js";
import { MePage } from "./MePage.js";

describe("expired customer session recovery", () => {
  it("shows recovery instead of waiting forever if sign-out does not update auth state", async () => {
    const currentUser = {
      uid: "customer-test",
      email: "customer@example.jp",
      getIdToken: vi.fn(async () => "stale-token"),
    };
    const authClient: AuthClient = {
      currentUser: () => currentUser,
      subscribe: (listener) => {
        queueMicrotask(() => listener(currentUser));
        return () => undefined;
      },
      signIn: async () => currentUser,
      signInWithCustomToken: async () => currentUser,
      signUp: async () => ({
        uid: "customer-test",
        email: null,
        getIdToken: async () => "token",
      }),
      signOut: async () => {
        throw new Error("transient client failure");
      },
    };
    const apiClient = createApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getCurrentUser: () => currentUser,
      signOut: vi.fn(async () => {
        throw new Error("sign-out did not clear local session");
      }),
      fetcher: vi.fn<typeof fetch>(async () =>
        Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
      ),
    });

    render(
      <AuthProvider client={authClient}>
        <MemoryRouter initialEntries={["/me"]}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/me" element={<MePage apiClient={apiClient} />} />
            </Route>
            <Route path="/login" element={<div>login route</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.sessionExpiredError,
    );
    expect(screen.queryByText(webMessages.profileLoading)).toBeNull();
    expect(
      screen.getByRole("button", { name: webMessages.logout }),
    ).toBeTruthy();
  });
});

describe("customer contract summary", () => {
  it("shows no contract instead of a permanent loader for a legacy account", async () => {
    const currentUser = {
      uid: "legacy-customer",
      email: "legacy@example.jp",
      getIdToken: vi.fn(async () => "customer-token"),
    };
    const authClient: AuthClient = {
      currentUser: () => currentUser,
      subscribe: (listener) => {
        queueMicrotask(() => listener(currentUser));
        return () => undefined;
      },
      signIn: async () => currentUser,
      signInWithCustomToken: async () => currentUser,
      signUp: async () => currentUser,
      signOut: async () => undefined,
    };
    const apiClient = {
      getMe: vi.fn(async () => ({
        customer: {
          id: "11111111-1111-4111-8111-111111111111",
          shopName: "喫茶ひだまり",
          contactName: "山田花子",
        },
      })),
      getContract: vi.fn(async () => ({ contract: null })),
    } as unknown as ReturnTypeApiClient;
    render(
      <AuthProvider client={authClient}>
        <MemoryRouter initialEntries={["/me"]}>
          <MePage apiClient={apiClient} showContractAccess={false} />
        </MemoryRouter>
      </AuthProvider>,
    );
    expect(await screen.findByText(webMessages.contractNone)).toBeTruthy();
    expect(screen.queryByText(webMessages.contractLoading)).toBeNull();
    expect(apiClient.getContract).not.toHaveBeenCalled();
  });

  it("shows the agreed plan and available period details from the contract API", async () => {
    const currentUser = {
      uid: "customer-test",
      email: "customer@example.jp",
      getIdToken: vi.fn(async () => "customer-token"),
    };
    const authClient: AuthClient = {
      currentUser: () => currentUser,
      subscribe: (listener) => {
        queueMicrotask(() => listener(currentUser));
        return () => undefined;
      },
      signIn: async () => ({
        uid: "customer-test",
        email: null,
        getIdToken: async () => "token",
      }),
      signInWithCustomToken: async () => ({
        uid: "customer-test",
        email: null,
        getIdToken: async () => "token",
      }),
      signUp: async () => ({
        uid: "customer-test",
        email: null,
        getIdToken: async () => "token",
      }),
      signOut: async () => undefined,
    };
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/me")) {
        return Response.json({
          customer: {
            id: "11111111-1111-4111-8111-111111111111",
            shopName: "喫茶ひだまり",
            contactName: "山田花子",
          },
        });
      }
      return Response.json({
        contract: {
          id: "22222222-2222-4222-8222-222222222222",
          status: "active",
          anchorDate: "2026-10-26",
          preview: false,
          plan: { name: "ライト", priceExclTax: 5000, credits: 1 },
          currentPeriod: {
            id: "33333333-3333-4333-8333-333333333333",
            seq: 1,
            startsOn: "2026-10-26",
            endsOn: "2026-11-25",
            priceExclTax: 5000,
            credits: 1,
            balance: 1,
          },
        },
      });
    });
    const apiClient = createApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getCurrentUser: () => currentUser,
      signOut: vi.fn(async () => undefined),
      fetcher,
    });
    render(
      <AuthProvider client={authClient}>
        <MemoryRouter initialEntries={["/me"]}>
          <MePage apiClient={apiClient} />
        </MemoryRouter>
      </AuthProvider>,
    );
    expect(
      await screen.findByText(
        /ライト・月額5,000円（税抜）（税込5,500円）・1クレジット/,
      ),
    ).toBeTruthy();
    expect(screen.getByText("2026-10-26〜2026-11-25")).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3000/api/v1/me/contract"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer customer-token",
        }),
      }),
    );
  });
});
