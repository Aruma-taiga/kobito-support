// @vitest-environment jsdom

import { webMessages } from "@kobito/shared";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthClient } from "../auth/session.js";
import { AuthProvider } from "../auth/session.js";
import { ApiClientError } from "../platform/api-client.js";
import { ApplicationPage } from "./ApplicationPage.js";
import { LoginPage } from "./LoginPage.js";

const config = {
  serviceName: "コビトサポート",
  application: {
    mode: "preview" as const,
    terms: { url: "https://example.test/terms", version: "draft-1" },
    privacy: { url: "https://example.test/privacy", version: "draft-1" },
    disclosure: { url: "https://example.test/disclosure", version: "draft-1" },
    availablePaymentMethods: ["bank_transfer" as const],
    konbiniFeeYen: null,
    displayVersion: "a".repeat(64),
    conditions: {
      initialDueDays: 7,
      extraCreditGrossYen: 4000,
      monthlyPrepaid: true,
      periodBasis: "contract_anchor" as const,
      rollover: false,
      cancellation: "period_end_no_proration" as const,
    },
  },
};
const plans = {
  displayVersion: "a".repeat(64),
  plans: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      code: "light",
      name: "ライト",
      priceInclTax: 5000,
      credits: 1,
      isCustom: false,
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      code: "standard",
      name: "スタンダード",
      priceInclTax: 10000,
      credits: 3,
      isCustom: false,
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      code: "premium",
      name: "プレミアム",
      priceInclTax: 15000,
      credits: 5,
      isCustom: false,
    },
    {
      id: "00000000-0000-4000-8000-000000000004",
      code: "custom",
      name: "個別見積り",
      priceInclTax: null,
      credits: null,
      isCustom: true,
    },
  ],
};

function setup(
  options: {
    authenticated?: boolean;
    initialPath?: string;
    postApplication?: ReturnType<typeof vi.fn>;
    signUp?: ReturnType<typeof vi.fn>;
    configSequence?: unknown[];
    plansSequence?: unknown[];
    routerMode?: "memory" | "browser";
  } = {},
) {
  const authenticated = options.authenticated ?? false;
  const postApplication =
    options.postApplication ??
    vi.fn(async () => ({
      applicationId: "00000000-0000-4000-8000-000000000011",
      contractId: "00000000-0000-4000-8000-000000000012",
      status: "under_review" as const,
      replayed: false,
    }));
  cleanup();
  const user = {
    email: "shop@example.jp",
    getIdToken: vi.fn(async () => "id-token"),
  };
  let signedIn = authenticated;
  let listener: ((current: typeof user | null) => void) | undefined;
  const signUpImpl =
    options.signUp ??
    vi.fn(async () => {
      signedIn = true;
      listener?.(user);
      return user;
    });
  const configSequence = [...(options.configSequence ?? [config])];
  const plansSequence = [...(options.plansSequence ?? [plans])];
  const authClient = {
    currentUser: () => (signedIn ? user : null),
    subscribe: (notify: (current: typeof user | null) => void) => {
      listener = notify;
      queueMicrotask(() => notify(authenticated ? user : null));
      return () => undefined;
    },
    signIn: vi.fn(async () => {
      signedIn = true;
      listener?.(user);
    }),
    signUp: signUpImpl,
    signOut: vi.fn(async () => {
      listener?.(null);
    }),
  } as unknown as AuthClient;
  const apiClient = {
    getPublicConfig: vi.fn(async () => configSequence.shift() ?? config),
    getPublicPlans: vi.fn(async () => plansSequence.shift() ?? plans),
    getPublicPartner: vi.fn(async (code: string) => ({
      code,
      name: "佐藤さん",
    })),
    postApplication,
  };
  if (options.routerMode === "browser") {
    window.history.replaceState(null, "", options.initialPath ?? "/apply/shop");
  }
  const routes = (
    <Routes>
      <Route
        path="/apply/*"
        element={
          <ApplicationPage
            apiClient={apiClient as never}
            authClient={authClient}
          />
        }
      />
      <Route path="/login" element={<LoginPage authClient={authClient} />} />
      <Route path="/me" element={<p>マイページ</p>} />
    </Routes>
  );
  render(
    <AuthProvider client={authClient}>
      {options.routerMode === "browser" ? (
        <BrowserRouter>{routes}</BrowserRouter>
      ) : (
        <MemoryRouter initialEntries={[options.initialPath ?? "/apply/shop"]}>
          {routes}
        </MemoryRouter>
      )}
    </AuthProvider>,
  );
  return { apiClient, authClient, postApplication, signUp: signUpImpl };
}

async function completeShopStep(authenticated = false) {
  await screen.findByLabelText(/店舗名/);
  fireEvent.change(screen.getByLabelText(/店舗名/), {
    target: { value: "喫茶ひだまり" },
  });
  fireEvent.change(screen.getByLabelText(/ご担当者のお名前/), {
    target: { value: "山田 花子" },
  });
  fireEvent.change(screen.getByLabelText(/メールアドレス/), {
    target: { value: "shop@example.jp" },
  });
  if (!authenticated) {
    fireEvent.change(screen.getByLabelText(/パスワード/), {
      target: { value: "secret-password" },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
  await screen.findByRole("heading", { name: "プランを選ぶ" });
}

describe("application flow", () => {
  afterEach(cleanup);
  it("keeps the draft when moving back and forward between steps", async () => {
    setup();
    await completeShopStep();
    fireEvent.click(screen.getByRole("button", { name: /戻る/ }));
    expect((await screen.findByLabelText(/店舗名/)).getAttribute("value")).toBe(
      "喫茶ひだまり",
    );
  });

  it("does not show a success receipt when someone opens the done URL directly", async () => {
    setup({ initialPath: "/apply/done" });
    expect(
      await screen.findByRole("heading", { name: "店舗情報" }),
    ).toBeTruthy();
    expect(screen.queryByText("お申し込みを受け付けました")).toBeNull();
  });

  it("keeps the receipt after a successful submission with browser navigation", async () => {
    setup({ routerMode: "browser" });
    await completeShopStep();
    fireEvent.click(screen.getByRole("radio", { name: /ライト/ }));
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "お支払い方法" });
    fireEvent.click(screen.getByRole("radio", { name: /銀行振込/ }));
    fireEvent.change(screen.getByLabelText(/請求先の名称/), {
      target: { value: "喫茶ひだまり" },
    });
    fireEvent.change(screen.getByLabelText(/請求先の住所/), {
      target: { value: "東京都杉並区1-2-3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "ご要望" });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "申込み内容の確認" });
    fireEvent.click(screen.getByLabelText(/事業のために利用/));
    fireEvent.click(screen.getByLabelText(/利用規約/));
    fireEvent.click(screen.getByRole("button", { name: /申し込む/ }));

    expect(
      await screen.findByRole("heading", {
        name: webMessages.applicationReceiptTitle,
      }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe("/apply/done");
  });

  it("uses the signed-in account email without collecting a new password", async () => {
    setup({ authenticated: true });
    await screen.findByLabelText(/店舗名/);
    expect(screen.queryByLabelText(/パスワード/)).toBeNull();
    expect(
      (screen.getByLabelText(/メールアドレス/) as HTMLInputElement).readOnly,
    ).toBe(true);
  });

  it("rejects mismatched public versions and recovers only after a coherent retry", async () => {
    const mismatchedPlans = { ...plans, displayVersion: "b".repeat(64) };
    const { apiClient, signUp, postApplication } = setup({
      configSequence: [config, config],
      plansSequence: [mismatchedPlans, plans],
    });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "申込み情報を読み込めませんでした。",
    );
    expect(signUp).not.toHaveBeenCalled();
    expect(postApplication).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /再試行/ }));
    expect(
      await screen.findByRole("heading", { name: "店舗情報" }),
    ).toBeTruthy();
    expect(signUp).not.toHaveBeenCalled();
    expect(postApplication).not.toHaveBeenCalled();
    expect(apiClient.getPublicConfig).toHaveBeenCalledTimes(2);
  });

  it("directs an existing Firebase email to controlled login resume", async () => {
    const signUp = vi.fn(async () => {
      throw Object.assign(new Error("already in use"), {
        code: "auth/email-already-in-use",
      });
    });
    setup({ signUp });
    await completeShopStep();
    fireEvent.click(screen.getByRole("radio", { name: /ライト/ }));
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "お支払い方法" });
    fireEvent.click(screen.getByRole("radio", { name: /銀行振込/ }));
    fireEvent.change(screen.getByLabelText(/請求先の名称/), {
      target: { value: "喫茶ひだまり" },
    });
    fireEvent.change(screen.getByLabelText(/請求先の住所/), {
      target: { value: "東京都杉並区1-2-3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "ご要望" });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "申込み内容の確認" });
    fireEvent.click(screen.getByLabelText(/事業のために利用/));
    fireEvent.click(screen.getByLabelText(/利用規約/));
    fireEvent.click(screen.getByRole("button", { name: /申し込む/ }));

    const resumeLink = await screen.findByRole("link", {
      name: webMessages.applicationLoginResume,
    });
    expect(resumeLink.getAttribute("href")).toBe("/login?next=apply");
    expect(screen.queryByText("マイページ")).toBeNull();
  });

  it("sends an API application conflict to /me with separate guidance", async () => {
    const postApplication = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError("application_conflict"));
    const { signUp } = setup({ authenticated: true, postApplication });
    await completeShopStep(true);
    fireEvent.click(screen.getByRole("radio", { name: /ライト/ }));
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "お支払い方法" });
    fireEvent.click(screen.getByRole("radio", { name: /銀行振込/ }));
    fireEvent.change(screen.getByLabelText(/請求先の名称/), {
      target: { value: "喫茶ひだまり" },
    });
    fireEvent.change(screen.getByLabelText(/請求先の住所/), {
      target: { value: "東京都杉並区1-2-3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "ご要望" });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "申込み内容の確認" });
    fireEvent.click(screen.getByLabelText(/事業のために利用/));
    fireEvent.click(screen.getByLabelText(/利用規約/));
    fireEvent.click(screen.getByRole("button", { name: /申し込む/ }));

    expect(
      await screen.findByText(webMessages.applicationAlreadySubmittedGuidance),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "マイページ" }).getAttribute("href"),
    ).toBe("/me");
    expect(screen.queryByText(webMessages.applicationExistingEmail)).toBeNull();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("keeps C01 and C02 disabled until the required consent is checked", async () => {
    setup();
    await completeShopStep();
    fireEvent.click(screen.getByRole("radio", { name: /ライト/ }));
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "お支払い方法" });
    fireEvent.click(screen.getByRole("radio", { name: /銀行振込/ }));
    fireEvent.change(screen.getByLabelText(/請求先の名称/), {
      target: { value: "喫茶ひだまり" },
    });
    fireEvent.change(screen.getByLabelText(/請求先の住所/), {
      target: { value: "東京都杉並区1-2-3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "ご要望" });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "申込み内容の確認" });
    expect(
      screen.getByText(/月額4,546円（税抜）・5,000円（税込）/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /申し込む/ }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows public tax-exclusive monthly prices beside accepted gross prices", async () => {
    const publicPlans = {
      ...plans,
      plans: plans.plans.map((item) =>
        item.code === "light" ? { ...item, priceInclTax: 5500 } : item,
      ),
    };
    const publicConfig = {
      ...config,
      application: {
        ...config.application,
        conditions: {
          ...config.application.conditions,
          extraCreditGrossYen: 4400,
        },
      },
    };
    setup({ plansSequence: [publicPlans], configSequence: [publicConfig] });
    await completeShopStep();

    expect(
      screen.getByRole("radio", { name: /ライト/ }).parentElement?.textContent,
    ).toContain("月額5,000円（税抜）5,500円（税込）");
    fireEvent.click(screen.getByRole("radio", { name: /ライト/ }));
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "お支払い方法" });
    fireEvent.click(screen.getByRole("radio", { name: /銀行振込/ }));
    fireEvent.change(screen.getByLabelText(/請求先の名称/), {
      target: { value: "喫茶ひだまり" },
    });
    fireEvent.change(screen.getByLabelText(/請求先の住所/), {
      target: { value: "東京都杉並区1-2-3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "ご要望" });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "申込み内容の確認" });

    expect(screen.getByText(/5,000円（税抜）・5,500円（税込）/)).toBeTruthy();
    expect(
      screen.getByText(/追加クレジットは1C 4,000円（税抜）・4,400円（税込）/),
    ).toBeTruthy();
  });

  it("requires C04 when a referral code is present", async () => {
    setup();
    await completeShopStep();
    fireEvent.click(screen.getByRole("radio", { name: /ライト/ }));
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "お支払い方法" });
    fireEvent.click(screen.getByRole("radio", { name: /銀行振込/ }));
    fireEvent.change(screen.getByLabelText(/請求先の名称/), {
      target: { value: "喫茶ひだまり" },
    });
    fireEvent.change(screen.getByLabelText(/請求先の住所/), {
      target: { value: "東京都杉並区1-2-3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "ご要望" });
    fireEvent.change(screen.getByLabelText(/紹介コード/), {
      target: { value: "SP-0012" },
    });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "申込み内容の確認" });
    expect(screen.getByText(/紹介者に、契約/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /申し込む/ }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("never submits the password and retries with the same idempotency key", async () => {
    const postApplication = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({
        applicationId: "app-1",
        contractId: "contract-1",
        status: "under_review",
        replayed: true,
      });
    const { signUp } = setup({ postApplication });
    await completeShopStep();
    fireEvent.click(screen.getByRole("radio", { name: /ライト/ }));
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "お支払い方法" });
    fireEvent.click(screen.getByRole("radio", { name: /銀行振込/ }));
    fireEvent.change(screen.getByLabelText(/請求先の名称/), {
      target: { value: "喫茶ひだまり" },
    });
    fireEvent.change(screen.getByLabelText(/請求先の住所/), {
      target: { value: "東京都杉並区1-2-3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "ご要望" });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "申込み内容の確認" });
    fireEvent.click(screen.getByLabelText(/事業のために利用/));
    fireEvent.click(screen.getByLabelText(/利用規約/));
    const submit = screen.getByRole("button", { name: /申し込む/ });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(postApplication).toHaveBeenCalledTimes(1));
    const firstCall = postApplication.mock.calls[0];
    if (!firstCall) throw new Error("Expected an initial application request");
    const firstPayload = firstCall[0] as Record<string, unknown>;
    const firstKey = firstCall[1];
    expect(firstPayload).not.toHaveProperty("password");
    expect(signUp).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /再試行/ }));
    await waitFor(() => expect(postApplication).toHaveBeenCalledTimes(2));
    const secondCall = postApplication.mock.calls[1];
    if (!secondCall) throw new Error("Expected one retry request");
    const secondKey = secondCall[1];
    expect(secondKey).toBe(firstKey);
    expect(signUp).toHaveBeenCalledTimes(1);
    await act(async () => undefined);
  });

  it("refreshes changed conditions, clears consent, and uses a new key only after reconfirmation", async () => {
    const postApplication = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError("conditions_changed"))
      .mockResolvedValueOnce({
        applicationId: "00000000-0000-4000-8000-000000000021",
        contractId: "00000000-0000-4000-8000-000000000022",
        status: "under_review",
        replayed: false,
      });
    const { apiClient, signUp } = setup({ postApplication });
    await completeShopStep();
    fireEvent.click(screen.getByRole("radio", { name: /ライト/ }));
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "お支払い方法" });
    fireEvent.click(screen.getByRole("radio", { name: /銀行振込/ }));
    fireEvent.change(screen.getByLabelText(/請求先の名称/), {
      target: { value: "喫茶ひだまり" },
    });
    fireEvent.change(screen.getByLabelText(/請求先の住所/), {
      target: { value: "東京都杉並区1-2-3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "ご要望" });
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await screen.findByRole("heading", { name: "申込み内容の確認" });
    fireEvent.click(screen.getByLabelText(/事業のために利用/));
    fireEvent.click(screen.getByLabelText(/利用規約/));
    const changedConfig = {
      ...config,
      application: { ...config.application, displayVersion: "b".repeat(64) },
    };
    const changedPlans = { ...plans, displayVersion: "b".repeat(64) };
    (apiClient.getPublicConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      changedConfig,
    );
    (apiClient.getPublicPlans as ReturnType<typeof vi.fn>).mockResolvedValue(
      changedPlans,
    );
    fireEvent.click(screen.getByRole("button", { name: /申し込む/ }));
    await waitFor(() => expect(postApplication).toHaveBeenCalledTimes(1));
    await screen.findByText(webMessages.applicationReconfirmRequired);
    await waitFor(() =>
      expect(apiClient.getPublicConfig).toHaveBeenCalledTimes(2),
    );
    expect(postApplication).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /申し込む/ }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByLabelText(/事業のために利用/));
    fireEvent.click(screen.getByLabelText(/利用規約/));
    fireEvent.click(screen.getByRole("button", { name: /申し込む/ }));
    await waitFor(() => expect(postApplication).toHaveBeenCalledTimes(2));
    const firstCall = postApplication.mock.calls[0];
    const secondCall = postApplication.mock.calls[1];
    expect(secondCall?.[1]).not.toBe(firstCall?.[1]);
    expect(signUp).toHaveBeenCalledTimes(1);
  });
});
