// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AuthClient,
  AuthProvider,
  type AuthUser,
} from "../auth/session.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";
import { ContactProvider } from "../platform/contact.js";
import { ContractPage } from "./ContractPage.js";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("contract LINE account status", () => {
  it("reloads status for a new UID and discards the old request result", async () => {
    const first = deferred<{ linked: boolean }>();
    const second = deferred<{ linked: boolean }>();
    const firstUser: AuthUser = {
      uid: "customer-a",
      email: "a@example.jp",
      getIdToken: vi.fn(async () => "a-token"),
    };
    let currentUser: AuthUser | null = firstUser;
    const listeners = new Set<(user: AuthUser | null) => void>();
    const authClient: AuthClient = {
      currentUser: () => currentUser,
      subscribe: (listener) => {
        listeners.add(listener);
        queueMicrotask(() => listener(currentUser));
        return () => listeners.delete(listener);
      },
      signIn: vi.fn(async () => firstUser),
      signInWithCustomToken: vi.fn(async () => firstUser),
      signUp: vi.fn(async () => firstUser),
      signOut: vi.fn(async () => undefined),
    };
    const getLineLinkStatus = vi
      .fn<(uid?: string) => Promise<{ linked: boolean }>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const apiClient = {
      getContract: vi.fn(async () => ({
        contract: {
          id: "11111111-1111-4111-8111-111111111111",
          status: "active" as const,
          anchorDate: null,
          preview: false,
          plan: null,
          currentPeriod: null,
        },
      })),
      getLineLinkStatus,
    } as unknown as ReturnTypeApiClient;
    render(
      <ContactProvider value={{ lineEnabled: true, contactEmail: null }}>
        <AuthProvider client={authClient}>
          <MemoryRouter initialEntries={["/me/contract"]}>
            <Routes>
              <Route
                path="/me/contract"
                element={
                  <ContractPage
                    apiClient={apiClient}
                    lineLiffId="2000000000-AbCdEfGh"
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ContactProvider>,
    );
    await waitFor(() =>
      expect(getLineLinkStatus).toHaveBeenCalledWith("customer-a"),
    );
    const nextUser: AuthUser = {
      uid: "customer-b",
      email: "b@example.jp",
      getIdToken: vi.fn(async () => "b-token"),
    };
    currentUser = nextUser;
    listeners.forEach((listener) => {
      listener(nextUser);
    });
    await waitFor(() =>
      expect(getLineLinkStatus).toHaveBeenCalledWith("customer-b"),
    );
    second.resolve({ linked: false });
    expect(
      await screen.findByRole("link", { name: "LINEを連携する" }),
    ).toBeTruthy();
    first.resolve({ linked: true });
    await Promise.resolve();
    expect(screen.queryByText("LINE連携済み")).toBeNull();
    expect(screen.getByRole("link", { name: "LINEを連携する" })).toBeTruthy();
  });
});
