// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthClient, AdminAuthUser } from "../auth/admin-session.js";
import { AdminAuthClientError } from "../auth/firebase-admin-client.js";
import type { AdminApiClient } from "../platform/admin-api-client.js";
import { AdminApp } from "./AdminApp.js";

afterEach(cleanup);

function setup(
  overrides: Partial<AdminAuthClient> = {},
  initialPath = "/admin/enroll",
) {
  const listeners = new Set<(user: AdminAuthUser | null) => void>();
  let currentUser: AdminAuthUser | null = null;
  const client: AdminAuthClient = {
    currentUser: () => currentUser,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(currentUser);
      return () => listeners.delete(listener);
    },
    signIn: vi.fn(async () => {
      currentUser = {
        email: "root@example.jp",
        getIdToken: async () => "token",
      };
      for (const listener of listeners) listener(currentUser);
      return { status: "signed_in" as const };
    }),
    startTotpEnrollment: vi.fn(async () => ({
      secret: "JBSWY3DPEHPK3PXP",
      uri: "otpauth://totp/Admin:root%40example.jp?secret=JBSWY3DPEHPK3PXP",
    })),
    completeTotpEnrollment: vi.fn(async () => undefined),
    clearTotpEnrollment: vi.fn(),
    startSecondFactor: vi.fn(async () => undefined),
    completeSecondFactor: vi.fn(async () => undefined),
    cancelSecondFactor: vi.fn(),
    signOut: vi.fn(async () => {
      currentUser = null;
      for (const listener of listeners) listener(null);
    }),
    ...overrides,
  };
  const apiClient = {
    getSession: vi.fn(async () => ({ role: "admin" as const })),
  } as unknown as AdminApiClient;
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/admin/*"
          element={
            <AdminApp
              authClient={client}
              apiClient={apiClient}
              serviceName="サービス"
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { client, apiClient };
}

describe("admin TOTP enrollment", () => {
  it("signs in and displays the secret and URI, then clears the secret on completion", async () => {
    const { client, apiClient } = setup();
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "root@example.jp" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "password-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登録を開始/ }));
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    expect(screen.getByText(/otpauth:\/\/totp/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("認証アプリのコード"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登録する/ }));
    expect(await screen.findByText(/通常の管理者ログイン/)).toBeTruthy();
    expect(screen.queryByText("JBSWY3DPEHPK3PXP")).toBeNull();
    expect(client.completeTotpEnrollment).toHaveBeenCalledWith(
      "JBSWY3DPEHPK3PXP",
      "123456",
    );
    expect(client.clearTotpEnrollment).toHaveBeenCalled();
    expect(apiClient.getSession).not.toHaveBeenCalled();
  });

  it("shows a friendly error for an incorrect code and keeps the secret available to retry", async () => {
    setup({
      completeTotpEnrollment: vi.fn(async () => {
        throw new Error("auth/invalid-verification-code");
      }),
    });
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "root@example.jp" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "password-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登録を開始/ }));
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("認証アプリのコード"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登録する/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText(/auth\/invalid-verification-code/)).toBeNull(),
    );
  });

  it("explains when MFA is already registered", async () => {
    setup({
      startTotpEnrollment: vi.fn(async () => {
        throw new AdminAuthClientError("already_enrolled");
      }),
    });
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "root@example.jp" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "password-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登録を開始/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/すでに2段階認証/)).toBeTruthy();
  });

  it("explains when re-login is needed", async () => {
    setup({
      startTotpEnrollment: vi.fn(async () => {
        throw new AdminAuthClientError("reauth_required");
      }),
    });
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "root@example.jp" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "password-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登録を開始/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/もう一度ログイン/)).toBeTruthy();
  });

  it("explains when re-login becomes necessary while confirming the code", async () => {
    setup({
      completeTotpEnrollment: vi.fn(async () => {
        throw Object.assign(new Error("reauth"), {
          code: "auth/requires-recent-login",
        });
      }),
    });
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "root@example.jp" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "password-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登録を開始/ }));
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("認証アプリのコード"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登録する/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/もう一度ログイン/)).toBeTruthy();
  });

  it("links from the login page to enrollment", () => {
    setup({}, "/admin/login");
    fireEvent.click(
      screen.getByRole("link", { name: "初回の2段階認証の登録" }),
    );
    expect(
      screen.getByRole("heading", { name: "2段階認証の登録" }),
    ).toBeTruthy();
  });
});
