// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthClient, AuthUser } from "../auth/session.js";
import { AuthProvider } from "../auth/session.js";
import { LoginPage } from "./LoginPage.js";

function setup(initialPath: string, lineLiffId?: string) {
  let user: AuthUser | null = null;
  const listeners = new Set<(current: AuthUser | null) => void>();
  const authClient: AuthClient = {
    currentUser: () => user,
    subscribe: (listener) => {
      listeners.add(listener);
      queueMicrotask(() => listener(user));
      return () => listeners.delete(listener);
    },
    signIn: vi.fn(async () => {
      const signedInUser = {
        uid: "shop-test",
        email: "shop@example.jp",
        getIdToken: async () => "token",
      };
      user = signedInUser;
      for (const listener of listeners) listener(user);
      return signedInUser;
    }),
    signInWithCustomToken: vi.fn(async () => ({
      uid: "shop-test",
      email: "shop@example.jp",
      getIdToken: async () => "token",
    })),
    signUp: vi.fn(async () => ({
      uid: "new-shop-test",
      email: null,
      getIdToken: async () => "token",
    })),
    signOut: vi.fn(async () => {
      user = null;
      for (const listener of listeners) listener(null);
    }),
  };
  render(
    <AuthProvider client={authClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/login"
            element={
              <LoginPage authClient={authClient} lineLiffId={lineLiffId} />
            }
          />
          <Route path="/apply/shop" element={<p>申込みフォーム</p>} />
          <Route path="/me" element={<p>マイページ</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
  return authClient;
}

async function signIn() {
  await screen.findByLabelText(/メールアドレス/);
  fireEvent.change(screen.getByLabelText(/メールアドレス/), {
    target: { value: "shop@example.jp" },
  });
  fireEvent.change(screen.getByLabelText(/パスワード/), {
    target: { value: "correct-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: /ログイン/ }));
}

describe("controlled login return", () => {
  afterEach(cleanup);

  it("returns to application after sign-in when next=apply", async () => {
    setup("/login?next=apply");
    await signIn();
    expect(await screen.findByText("申込みフォーム")).toBeTruthy();
    expect(screen.queryByText("マイページ")).toBeNull();
  });

  it("ignores external next values and keeps the usual /me destination", async () => {
    setup("/login?next=https%3A%2F%2Fevil.example");
    await signIn();
    expect(await screen.findByText("マイページ")).toBeTruthy();
    expect(screen.queryByText("申込みフォーム")).toBeNull();
  });

  it("shows the LINE entry only when a public LIFF ID is configured", async () => {
    setup("/login", "2000000000-AbCdEfGh");
    const lineLink = await screen.findByRole("link", {
      name: "LINEでログイン",
    });
    expect(lineLink.getAttribute("href")).toBe("/liff?to=home");
  });
});
