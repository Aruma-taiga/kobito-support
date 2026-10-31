// @vitest-environment jsdom

import { webMessages } from "@kobito/shared";
import { liff } from "@line/liff";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AuthClient,
  AuthProvider,
  type AuthUser,
} from "../auth/session.js";
import {
  ApiClientError,
  type ReturnTypeApiClient,
} from "../platform/api-client.js";
import { LiffPage } from "./LiffPage.js";

vi.mock("@line/liff", () => ({
  liff: {
    init: vi.fn(async () => undefined),
    isLoggedIn: vi.fn(() => true),
    getIDToken: vi.fn(() => "line-id-token"),
    login: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(liff.init).mockResolvedValue(undefined);
  vi.mocked(liff.init).mockClear();
  vi.mocked(liff.isLoggedIn).mockReturnValue(false);
  vi.mocked(liff.getIDToken).mockReturnValue("line-id-token");
  vi.mocked(liff.login).mockReset();
});

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setup(
  options: {
    user?: AuthUser | null;
    api?: Record<string, unknown>;
    configured?: boolean;
    path?: string;
    lineLoggedIn?: boolean;
    strict?: boolean;
  } = {},
) {
  window.history.replaceState(null, "", options.path ?? "/liff?to=home");
  vi.mocked(liff.isLoggedIn).mockReturnValue(options.lineLoggedIn ?? true);
  const user =
    options.user === undefined
      ? {
          uid: "customer-1",
          email: "customer@example.jp",
          getIdToken: async () => "firebase-token",
        }
      : options.user;
  const listeners = new Set<(user: AuthUser | null) => void>();
  let currentUser = user;
  const authClient: AuthClient = {
    currentUser: () => currentUser,
    subscribe: (listener) => {
      listeners.add(listener);
      queueMicrotask(() => listener(currentUser));
      return () => listeners.delete(listener);
    },
    signIn: vi.fn(async (email) => {
      const signedInUser = {
        uid: "signed-in-customer",
        email,
        getIdToken: async () => "firebase-token",
      };
      currentUser = signedInUser;
      listeners.forEach((listener) => {
        listener(currentUser);
      });
      return signedInUser;
    }),
    signInWithCustomToken: vi.fn(async () => {
      const authenticatedUser = user ?? {
        uid: "customer-1",
        email: null,
        getIdToken: async () => "firebase-token",
      };
      currentUser = authenticatedUser;
      listeners.forEach((listener) => {
        listener(currentUser);
      });
      return authenticatedUser;
    }),
    sendPasswordReset: async () => undefined,
    signUp: vi.fn(async () => ({
      uid: "new-user",
      email: null,
      getIdToken: async () => "firebase-token",
    })),
    signOut: vi.fn(async () => {
      currentUser = null;
      listeners.forEach((listener) => {
        listener(null);
      });
    }),
  };
  const apiClient = {
    signInWithLine: vi.fn(async () => {
      throw new ApiClientError("not_found");
    }),
    linkLine: vi.fn(async () => ({ linked: true })),
    ...options.api,
  } as unknown as ReturnTypeApiClient;
  const tree = (
    <AuthProvider client={authClient}>
      <MemoryRouter initialEntries={[options.path ?? "/liff?to=home"]}>
        <Routes>
          <Route
            path="/liff"
            element={
              <LiffPage
                apiClient={apiClient}
                authClient={authClient}
                liffId={
                  options.configured === false
                    ? undefined
                    : "2000000000-AbCdEfGh"
                }
              />
            }
          />
          <Route path="/me" element={<p>ホーム</p>} />
          <Route path="/me/requests/:id" element={<p>見積</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
  const view = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return {
    apiClient,
    authClient,
    unmount: view.unmount,
    setAuthUser(next: AuthUser | null) {
      currentUser = next;
      listeners.forEach((listener) => {
        listener(next);
      });
    },
  };
}

describe("LINE LIFF entry", () => {
  it("automatically signs in an already logged-in LIFF customer and opens home", async () => {
    const { apiClient, authClient } = setup({
      user: null,
      lineLoggedIn: true,
      api: {
        signInWithLine: vi.fn(async () => ({
          customToken: "auto-custom-token",
          authUserId: "customer-1",
        })),
      },
    });

    expect(await screen.findByText("ホーム")).toBeTruthy();
    await waitFor(() => expect(liff.init).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(apiClient.signInWithLine).toHaveBeenCalledWith("line-id-token"),
    );
    await waitFor(() =>
      expect(authClient.signInWithCustomToken).toHaveBeenCalledWith(
        "auto-custom-token",
      ),
    );
  });

  it("automatically opens the approved estimate destination for an LIFF session", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const { authClient } = setup({
      user: null,
      lineLoggedIn: true,
      path: `/liff?to=estimate&id=${id}`,
      api: {
        signInWithLine: vi.fn(async () => ({
          customToken: "auto-custom-token",
          authUserId: "customer-1",
        })),
      },
    });

    expect(await screen.findByText("見積")).toBeTruthy();
    await waitFor(() =>
      expect(authClient.signInWithCustomToken).toHaveBeenCalledOnce(),
    );
  });

  it("resolves the return destination from the URL after LIFF initialization", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    vi.mocked(liff.init).mockImplementation(async () => {
      window.history.replaceState(
        null,
        "",
        `/liff?to=estimate&id=${id}&liff.state=preserved-until-init`,
      );
    });
    setup({
      user: null,
      path: "/liff?to=home&liff.state=initial",
      lineLoggedIn: true,
      api: {
        signInWithLine: vi.fn(async () => ({
          customToken: "url-custom-token",
          authUserId: "customer-1",
        })),
      },
    });

    expect(await screen.findByText("見積")).toBeTruthy();
  });

  it("initializes LIFF for an external browser and waits for an explicit login action", async () => {
    const { apiClient } = setup({ user: null, lineLoggedIn: false });

    await screen.findByRole("button", { name: "LINEでログイン" });
    await waitFor(() => expect(liff.init).toHaveBeenCalledOnce());
    expect(apiClient.signInWithLine).not.toHaveBeenCalled();
    expect(liff.login).not.toHaveBeenCalled();
  });

  it("does not repeat the automatic LIFF exchange when auth state updates", async () => {
    const exchange = vi.fn(async () => ({
      customToken: "auto-custom-token",
      authUserId: "customer-1",
    }));
    const { apiClient } = setup({
      user: null,
      lineLoggedIn: true,
      api: { signInWithLine: exchange },
    });

    expect(await screen.findByText("ホーム")).toBeTruthy();
    await waitFor(() =>
      expect(apiClient.signInWithLine).toHaveBeenCalledOnce(),
    );
    await waitFor(() => expect(exchange).toHaveBeenCalledOnce());
  });

  it("initializes and exchanges once under StrictMode effect replay", async () => {
    const { apiClient } = setup({
      user: null,
      lineLoggedIn: true,
      strict: true,
      api: {
        signInWithLine: vi.fn(async () => ({
          customToken: "strict-custom-token",
          authUserId: "customer-1",
        })),
      },
    });

    expect(await screen.findByText("ホーム")).toBeTruthy();
    await waitFor(() => expect(liff.init).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(apiClient.signInWithLine).toHaveBeenCalledOnce(),
    );
  });

  it("does not claim to be configured when the public LIFF ID is absent", async () => {
    const { apiClient } = setup({ configured: false });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "LINE連携の準備中",
      ),
    );
    expect(apiClient.signInWithLine).not.toHaveBeenCalled();
    expect(liff.init).not.toHaveBeenCalled();
  });

  it("requires an explicit action before linking LINE to the signed-in customer", async () => {
    const { apiClient } = setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    await screen.findByText(/メールアドレスとパスワードでログイン/);
    await waitFor(() =>
      expect(apiClient.signInWithLine).toHaveBeenCalledWith("line-id-token"),
    );
    expect(apiClient.linkLine).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "LINEを連携する" }));
    await waitFor(() =>
      expect(apiClient.linkLine).toHaveBeenCalledWith(
        "line-id-token",
        "customer-1",
      ),
    );
  });

  it("links after email/password sign-in only when the customer submits the explicit action", async () => {
    const { apiClient, authClient } = setup({
      user: null,
      api: {
        signInWithLine: vi.fn(async () => {
          throw new ApiClientError("not_found");
        }),
      },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    await screen.findByLabelText("メールアドレス");
    expect(apiClient.linkLine).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "customer@example.jp" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "ログインしてLINEを連携" }),
    );
    await waitFor(() =>
      expect(apiClient.linkLine).toHaveBeenCalledWith(
        "line-id-token",
        "signed-in-customer",
      ),
    );
    await waitFor(() =>
      expect(authClient.signIn).toHaveBeenCalledWith(
        "customer@example.jp",
        "correct-password",
      ),
    );
  });

  it("does not link to a different UID than the account returned by password sign-in", async () => {
    const { apiClient, authClient, setAuthUser } = setup({
      user: null,
      api: {
        signInWithLine: vi.fn(async () => {
          throw new ApiClientError("not_found");
        }),
      },
    });
    const credentialUser: AuthUser = {
      uid: "credentials-customer",
      email: "customer@example.jp",
      getIdToken: async () => "credential-token",
    };
    authClient.signIn = vi.fn(async () => {
      setAuthUser({
        uid: "different-current-customer",
        email: "other@example.jp",
        getIdToken: async () => "other-token",
      });
      return credentialUser;
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    await screen.findByLabelText("メールアドレス");
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "customer@example.jp" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "ログインしてLINEを連携" }),
    );
    await waitFor(() => expect(authClient.signIn).toHaveBeenCalledOnce());
    expect(apiClient.linkLine).not.toHaveBeenCalled();
  });

  it("rejects arbitrary return query values to the home destination", async () => {
    const { authClient, apiClient } = setup({
      user: null,
      path: "/liff?to=https%3A%2F%2Fevil.example",
      api: {
        signInWithLine: vi.fn(async () => ({
          customToken: "custom-token",
          authUserId: "customer-1",
        })),
      },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    await waitFor(() =>
      expect(authClient.signInWithCustomToken).toHaveBeenCalledWith(
        "custom-token",
      ),
    );
    expect(await screen.findByText("ホーム")).toBeTruthy();
    await waitFor(() =>
      expect(apiClient.signInWithLine).toHaveBeenCalledWith("line-id-token"),
    );
  });

  it("returns an approved estimate deep link after a matching account is authenticated", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const { authClient } = setup({
      path: `/liff?to=estimate&id=${id}`,
      api: {
        signInWithLine: vi.fn(async () => ({
          customToken: "custom-token",
          authUserId: "customer-1",
        })),
      },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    await waitFor(() =>
      expect(authClient.signInWithCustomToken).toHaveBeenCalledWith(
        "custom-token",
      ),
    );
    expect(await screen.findByText("見積")).toBeTruthy();
  });

  it("requires confirmation before switching to another Firebase account", async () => {
    const { authClient } = setup({
      api: {
        signInWithLine: vi.fn(async () => ({
          customToken: "other-account-token",
          authUserId: "customer-linked-to-line",
        })),
      },
    });
    await screen.findByRole("alert");
    expect(authClient.signInWithCustomToken).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "LINEに連携したアカウントで続ける" }),
    );
    await waitFor(() =>
      expect(authClient.signInWithCustomToken).toHaveBeenCalledWith(
        "other-account-token",
      ),
    );
  });

  it("ignores a delayed exchange after sign-out instead of restoring a Firebase session", async () => {
    const exchange = deferred<{ customToken: string; authUserId: string }>();
    const { apiClient, authClient } = setup({
      api: { signInWithLine: vi.fn(() => exchange.promise) },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    await waitFor(() =>
      expect(apiClient.signInWithLine).toHaveBeenCalledOnce(),
    );
    await authClient.signOut();
    exchange.resolve({ customToken: "stale-token", authUserId: "customer-1" });
    await waitFor(() => expect(authClient.currentUser()).toBeNull());
    expect(authClient.signInWithCustomToken).not.toHaveBeenCalled();
  });

  it("ignores an exchange after an intervening sign-in and sign-out while initially signed out", async () => {
    const exchange = deferred<{ customToken: string; authUserId: string }>();
    const { apiClient, authClient, setAuthUser } = setup({
      user: null,
      api: { signInWithLine: vi.fn(() => exchange.promise) },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    await waitFor(() =>
      expect(apiClient.signInWithLine).toHaveBeenCalledOnce(),
    );
    setAuthUser({
      uid: "temporary-user",
      email: null,
      getIdToken: async () => "temp",
    });
    setAuthUser(null);
    exchange.resolve({ customToken: "stale-token", authUserId: "customer-1" });
    await Promise.resolve();
    expect(authClient.currentUser()).toBeNull();
    expect(authClient.signInWithCustomToken).not.toHaveBeenCalled();
  });

  it("ignores a delayed exchange when the LIFF page unmounts", async () => {
    const exchange = deferred<{ customToken: string; authUserId: string }>();
    const { apiClient, authClient, unmount } = setup({
      user: null,
      api: { signInWithLine: vi.fn(() => exchange.promise) },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    await waitFor(() =>
      expect(apiClient.signInWithLine).toHaveBeenCalledOnce(),
    );
    unmount();
    exchange.resolve({ customToken: "stale-token", authUserId: "customer-1" });
    await Promise.resolve();
    expect(authClient.signInWithCustomToken).not.toHaveBeenCalled();
  });

  it("allows retry after the LINE verification service becomes available", async () => {
    const exchange = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError("service_unavailable"))
      .mockResolvedValueOnce({
        customToken: "fresh-token",
        authUserId: "customer-1",
      });
    const { apiClient, authClient } = setup({
      user: null,
      api: { signInWithLine: exchange },
    });
    await screen.findByRole("button", { name: "LINEでログイン" });
    await screen.findByRole("alert");
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "LINEでログイン",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "LINEでログイン" }));
    await waitFor(() =>
      expect(authClient.signInWithCustomToken).toHaveBeenCalledWith(
        "fresh-token",
      ),
    );
    await waitFor(() =>
      expect(apiClient.signInWithLine).toHaveBeenCalledTimes(2),
    );
  });

  it("does not navigate if another Firebase account becomes current during LINE sign-in", async () => {
    const signIn = deferred<AuthUser>();
    const { authClient, setAuthUser } = setup({
      user: null,
      api: {
        signInWithLine: vi.fn(async () => ({
          customToken: "custom-token",
          authUserId: "customer-1",
        })),
      },
    });
    authClient.signInWithCustomToken = vi.fn(() => signIn.promise);
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    await waitFor(() =>
      expect(authClient.signInWithCustomToken).toHaveBeenCalledOnce(),
    );
    setAuthUser({
      uid: "other-current-account",
      email: "other@example.jp",
      getIdToken: async () => "other-token",
    });
    signIn.resolve({
      uid: "customer-1",
      email: "customer@example.jp",
      getIdToken: async () => "customer-token",
    });
    expect(await screen.findByText(webMessages.lineSwitchWarning)).toBeTruthy();
    expect(screen.queryByText("ホーム")).toBeNull();
  });

  it("does not navigate after the explicit account switch if the active UID changes", async () => {
    const signIn = deferred<AuthUser>();
    const { authClient, setAuthUser } = setup({
      api: {
        signInWithLine: vi.fn(async () => ({
          customToken: "linked-account-token",
          authUserId: "line-linked-account",
        })),
      },
    });
    authClient.signInWithCustomToken = vi.fn(() => signIn.promise);
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: webMessages.lineSwitchAccount,
      }),
    );
    await waitFor(() =>
      expect(authClient.signInWithCustomToken).toHaveBeenCalledOnce(),
    );
    setAuthUser({
      uid: "third-account",
      email: "third@example.jp",
      getIdToken: async () => "third-token",
    });
    signIn.resolve({
      uid: "line-linked-account",
      email: null,
      getIdToken: async () => "linked-token",
    });
    expect(await screen.findByText(webMessages.lineSwitchWarning)).toBeTruthy();
    expect(screen.queryByText("ホーム")).toBeNull();
  });

  it("rejects a custom-token credential whose UID differs from the exchange response", async () => {
    const { authClient, setAuthUser } = setup({
      user: null,
      api: {
        signInWithLine: vi.fn(async () => ({
          customToken: "custom-token",
          authUserId: "customer-1",
        })),
      },
    });
    const wrongUser: AuthUser = {
      uid: "unexpected-account",
      email: "unexpected@example.jp",
      getIdToken: async () => "unexpected-token",
    };
    authClient.signInWithCustomToken = vi.fn(async () => {
      setAuthUser(wrongUser);
      return wrongUser;
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    expect(await screen.findByText(webMessages.lineSwitchWarning)).toBeTruthy();
    expect(screen.queryByText("ホーム")).toBeNull();
  });

  it("does not navigate after the authenticated customer changes during a link request", async () => {
    const link = deferred<{ linked: true }>();
    const { apiClient, setAuthUser } = setup({
      api: {
        signInWithLine: vi.fn(async () => {
          throw new ApiClientError("not_found");
        }),
        linkLine: vi.fn(() => link.promise),
      },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEを連携する" }),
    );
    await waitFor(() => expect(apiClient.linkLine).toHaveBeenCalledOnce());
    setAuthUser({
      uid: "different-customer",
      email: null,
      getIdToken: async () => "new-token",
    });
    link.resolve({ linked: true });
    await Promise.resolve();
    expect(screen.queryByText("ホーム")).toBeNull();
  });

  it("reacquires a LINE token after link verification fails without signing out the customer", async () => {
    const linkLine = vi.fn(async () => {
      throw new ApiClientError("invalid_line_token");
    });
    const { apiClient, authClient } = setup({ api: { linkLine } });
    const originalUser = authClient.currentUser();
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEを連携する" }),
    );

    const reacquire = await screen.findByRole("button", {
      name: "LINEでログイン",
    });
    expect(authClient.currentUser()).toBe(originalUser);
    expect(authClient.signOut).not.toHaveBeenCalled();
    fireEvent.click(reacquire);
    await waitFor(() =>
      expect(apiClient.signInWithLine).toHaveBeenCalledTimes(2),
    );
  });

  it("reacquires a LINE token after password-assisted link failure and keeps the signed-in customer", async () => {
    const linkLine = vi.fn(async () => {
      throw new ApiClientError("invalid_line_token");
    });
    const { apiClient, authClient } = setup({
      user: null,
      api: { linkLine },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "LINEでログイン" }),
    );
    await screen.findByLabelText(webMessages.emailLabel);
    fireEvent.change(screen.getByLabelText(webMessages.emailLabel), {
      target: { value: "customer@example.jp" },
    });
    fireEvent.change(screen.getByLabelText(webMessages.passwordLabel), {
      target: { value: "temporary-password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.lineLinkAction }),
    );

    const reacquire = await screen.findByRole("button", {
      name: "LINEでログイン",
    });
    expect(authClient.currentUser()?.uid).toBe("signed-in-customer");
    expect(authClient.signOut).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(webMessages.emailLabel)).toBeNull();
    expect(screen.queryByLabelText(webMessages.passwordLabel)).toBeNull();
    fireEvent.click(reacquire);
    await waitFor(() =>
      expect(apiClient.signInWithLine).toHaveBeenCalledTimes(2),
    );
  });
});
