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
import type { AuthClient, AuthUser } from "../auth/session.js";
import { AuthProvider } from "../auth/session.js";
import { ContactProvider } from "../platform/contact.js";
import { LoginPage } from "./LoginPage.js";

function setup(
  initialPath: string,
  lineLiffId?: string,
  contactEmail: string | null = null,
) {
  let user: AuthUser | null = null;
  const sendPasswordReset = vi.fn(async (_email: string) => undefined);
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
    sendPasswordReset,
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
    <ContactProvider value={{ lineEnabled: false, contactEmail }}>
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
      </AuthProvider>
    </ContactProvider>,
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

describe("login screen copy", () => {
  afterEach(cleanup);

  it("explains what the mypage shows and where to ask when the password is forgotten", async () => {
    setup("/login", undefined, "info@cingulata.jp");
    expect(
      await screen.findByText(
        "ご契約の内容、残りのクレジット、ご依頼の状況、請求書を見られます。",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/パスワードを忘れたとき/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "info@cingulata.jp" })
        .getAttribute("href"),
    ).toBe("mailto:info@cingulata.jp");
    expect(document.body.textContent).not.toContain("LINE");
  });
});

describe("password reset", () => {
  afterEach(cleanup);
  const done =
    "登録されているメールアドレスの場合、再設定のご案内を送信しました。";

  async function openForm() {
    const client = setup("/login");
    fireEvent.click(
      await screen.findByRole("button", { name: "パスワードを忘れた方" }),
    );
    return client;
  }
  function fill(value: string) {
    fireEvent.change(screen.getByLabelText(/メールアドレス/), {
      target: { value },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /再設定のご案内を送る/ }),
    );
  }

  it("shows the entry point and the reset form", async () => {
    await openForm();
    expect(
      screen.getByRole("button", { name: /再設定のご案内を送る/ }),
    ).toBeTruthy();
  });

  it("shows the completion text after sending", async () => {
    const client = await openForm();
    fill("shop@example.jp");
    expect(await screen.findByText(new RegExp(done))).toBeTruthy();
    await waitFor(() =>
      expect(client.sendPasswordReset).toHaveBeenCalledWith("shop@example.jp"),
    );
  });

  it("shows the same text for an unregistered email", async () => {
    const client = await openForm();
    (
      client.sendPasswordReset as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(
      Object.assign(new Error("x"), { code: "auth/user-not-found" }),
    );
    fill("nobody@example.jp");
    expect(await screen.findByText(new RegExp(done))).toBeTruthy();
  });

  it("rejects a malformed email without sending", async () => {
    const client = await openForm();
    fill("not-an-email");
    expect(
      await screen.findByText("メールアドレスの形式を確認してください。"),
    ).toBeTruthy();
    expect(client.sendPasswordReset).not.toHaveBeenCalled();
  });

  it("disables the button while sending", async () => {
    const client = await openForm();
    let release: () => void = () => undefined;
    (
      client.sendPasswordReset as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    fill("shop@example.jp");
    const button = await screen.findByRole("button", {
      name: /送信しています/,
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    release();
    await screen.findByText(new RegExp(done));
    await waitFor(() =>
      expect(client.sendPasswordReset).toHaveBeenCalledTimes(1),
    );
  });

  it("shows a generic error on failure", async () => {
    const client = await openForm();
    (
      client.sendPasswordReset as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(
      Object.assign(new Error("x"), { code: "auth/network-request-failed" }),
    );
    fill("shop@example.jp");
    expect(await screen.findByText(/送信できませんでした/)).toBeTruthy();
    expect(screen.queryByText(new RegExp(done))).toBeNull();
  });
});
