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
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthClient } from "../auth/admin-session.js";
import { AdminApiError } from "../platform/admin-api-client.js";
import type { AdminApiClient } from "./AdminApp.js";
import { AdminApp } from "./AdminApp.js";

const customerId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const contractId = "33333333-3333-4333-8333-333333333333";
const user = {
  email: "admin@example.jp",
  getIdToken: vi.fn(async () => "admin-token"),
};
const queueItem = {
  customerId,
  shopName: "喫茶ひだまり",
  contactName: "山田 花子",
  email: "shop@example.jp",
  submittedAt: "2026-10-26T01:00:00.000Z",
  planName: "ライト",
  priceInclTax: 5000,
  credits: 1,
  paymentMethod: "bank_transfer" as const,
  status: "under_review" as const,
};
const detail = {
  customer: {
    id: customerId,
    shopName: "喫茶ひだまり",
    contactName: "山田 花子",
    email: "shop@example.jp",
    phone: null,
    billingName: "喫茶ひだまり",
    billingAddress: "東京都杉並区1-2-3",
    invoiceRegistrationNo: null,
  },
  application: {
    id: applicationId,
    submittedAt: queueItem.submittedAt,
    termsVersion: "terms-v1",
    privacyVersion: "privacy-v1",
    disclosureVersion: "disclosure-v1",
    consentBusinessUse: true,
    consentTerms: true,
    consentMarketing: false,
    consentPartnerShare: null,
    shownTerms: { planName: "ライト", priceInclTax: 5000, credits: 1 },
    referralCode: null,
    freeText: "<img src=x onerror=alert(1)>",
    reviewResult: null,
    rejectionNote: null,
  },
  contract: { id: contractId, status: "under_review" as const },
};

function setup(
  options: {
    initialPath?: string;
    signedIn?: boolean;
    signInResult?: Awaited<ReturnType<AdminAuthClient["signIn"]>>;
    getSession?: ReturnType<typeof vi.fn>;
    getApplications?: ReturnType<typeof vi.fn>;
    getCustomerDetail?: ReturnType<typeof vi.fn>;
    declineApplication?: ReturnType<typeof vi.fn>;
    completeSecondFactor?: ReturnType<typeof vi.fn>;
    signOut?: ReturnType<typeof vi.fn>;
  } = {},
) {
  let signedIn = options.signedIn ?? false;
  const listeners = new Set<(current: typeof user | null) => void>();
  const publish = () => {
    for (const listener of listeners) listener(signedIn ? user : null);
  };
  const authClient: AdminAuthClient = {
    currentUser: () => (signedIn ? user : null),
    subscribe: (listener) => {
      listeners.add(listener);
      queueMicrotask(publish);
      return () => listeners.delete(listener);
    },
    signIn: vi.fn(async () => {
      const result = options.signInResult ?? {
        status: "mfa_required" as const,
        factors: [
          {
            uid: "totp-1",
            factorId: "totp" as const,
            displayName: "認証アプリ",
          },
        ],
      };
      if (result.status === "signed_in") {
        signedIn = true;
        publish();
      }
      return result;
    }),
    startSecondFactor: vi.fn(async () => undefined),
    completeSecondFactor:
      options.completeSecondFactor ??
      vi.fn(async () => {
        signedIn = true;
        publish();
      }),
    cancelSecondFactor: vi.fn(),
    signOut:
      options.signOut ??
      vi.fn(async () => {
        signedIn = false;
        publish();
      }),
  };
  const apiClient: AdminApiClient = {
    getSession:
      options.getSession ?? vi.fn(async () => ({ role: "admin" as const })),
    getApplications:
      options.getApplications ??
      vi.fn(async () => ({
        items: [queueItem],
        page: 1,
        pageSize: 25,
        total: 1,
      })),
    getCustomerDetail: options.getCustomerDetail ?? vi.fn(async () => detail),
    declineApplication:
      options.declineApplication ??
      vi.fn(async () => ({
        applicationId,
        contractId,
        status: "declined" as const,
        replayed: false,
      })),
  };
  render(
    <MemoryRouter initialEntries={[options.initialPath ?? "/admin/login"]}>
      <Routes>
        <Route
          path="/admin/*"
          element={<AdminApp authClient={authClient} apiClient={apiClient} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return { authClient, apiClient };
}

async function fillLogin() {
  await screen.findByRole("heading", { name: webMessages.adminLoginTitle });
  fireEvent.change(screen.getByLabelText(webMessages.emailLabel), {
    target: { value: "admin@example.jp" },
  });
  fireEvent.change(screen.getByLabelText(webMessages.passwordLabel), {
    target: { value: "admin-password" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: webMessages.adminLoginButton }),
  );
}

async function finishMfa() {
  fireEvent.change(
    await screen.findByLabelText(webMessages.adminMfaTotpCodeLabel),
    {
      target: { value: "123456" },
    },
  );
  fireEvent.click(
    screen.getByRole("button", { name: webMessages.adminMfaCodeSubmit }),
  );
}

describe("admin MFA and review UI", () => {
  afterEach(cleanup);

  it("does not request or render the queue before MFA and server session verification", async () => {
    const { apiClient, authClient } = setup();
    await fillLogin();
    expect(
      await screen.findByRole("heading", {
        name: webMessages.adminMfaChallengeTitle,
      }),
    ).toBeTruthy();
    expect(apiClient.getSession).not.toHaveBeenCalled();
    expect(apiClient.getApplications).not.toHaveBeenCalled();

    await finishMfa();
    expect(await screen.findByText(queueItem.shopName)).toBeTruthy();
    expect(authClient.completeSecondFactor).toHaveBeenCalledWith(
      "totp-1",
      "123456",
    );
    expect(apiClient.getSession).toHaveBeenCalledOnce();
    expect(apiClient.getApplications).toHaveBeenCalledOnce();
  });

  it("shows a safe error after a wrong MFA code and never opens the queue", async () => {
    const { apiClient } = setup({
      completeSecondFactor: vi.fn(async () => {
        throw new Error("auth/invalid-verification-code");
      }),
    });
    await fillLogin();
    fireEvent.change(
      await screen.findByLabelText(webMessages.adminMfaTotpCodeLabel),
      {
        target: { value: "123456" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminMfaCodeSubmit }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.adminMfaInvalidCode,
    );
    expect(apiClient.getSession).not.toHaveBeenCalled();
    expect(apiClient.getApplications).not.toHaveBeenCalled();
  });

  it("starts emulator SMS MFA with a mounted verifier container", async () => {
    const { authClient } = setup({
      signInResult: {
        status: "mfa_required",
        factors: [{ uid: "phone-1", factorId: "phone", displayName: null }],
      },
    });
    await fillLogin();
    await waitFor(() =>
      expect(authClient.startSecondFactor).toHaveBeenCalledOnce(),
    );
    const [factorUid, verifierContainer] =
      vi.mocked(authClient.startSecondFactor).mock.calls[0] ?? [];
    expect(factorUid).toBe("phone-1");
    expect(verifierContainer).toBeInstanceOf(HTMLDivElement);
  });

  it.each([
    ["forbidden", webMessages.adminAccountDisabled],
    ["not_found", webMessages.adminRoleRequired],
  ] as const)("blocks an account rejected by the server (%s)", async (code, message) => {
    const getSession = vi.fn(async () => {
      throw new AdminApiError(code);
    });
    const { apiClient } = setup({
      signInResult: { status: "signed_in" },
      getSession,
    });
    await fillLogin();
    expect((await screen.findByRole("alert")).textContent).toContain(message);
    expect(apiClient.getApplications).not.toHaveBeenCalled();
  });

  it("shows queue and details as text, then confirms decline and refreshes queue data", async () => {
    const getApplications = vi.fn(async () => ({
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    }));
    const { apiClient } = setup({
      initialPath: `/admin/customers/${customerId}`,
      signedIn: true,
      getApplications,
    });
    expect(await screen.findByText(queueItem.shopName)).toBeTruthy();
    expect(screen.getByText("terms-v1")).toBeTruthy();
    expect(
      (
        screen.getByLabelText(
          webMessages.applicationConsentBusiness,
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      screen.getByText(detail.application.freeText as string),
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminDecline }),
    );
    expect(screen.getByText(webMessages.adminDeclineConfirm)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminDeclineCancel }),
    );
    expect(apiClient.declineApplication).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminDecline }),
    );
    fireEvent.change(screen.getByLabelText(webMessages.adminDeclineReason), {
      target: { value: "審査基準を満たさないため" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: webMessages.adminDeclineConfirmButton,
      }),
    );
    await waitFor(() =>
      expect(apiClient.declineApplication).toHaveBeenCalledOnce(),
    );
    expect(apiClient.declineApplication).toHaveBeenCalledWith(applicationId, {
      rejectionNote: "審査基準を満たさないため",
    });
    expect(
      await screen.findByText(webMessages.adminDeclineSuccess),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("link", { name: webMessages.adminQueueTitle }),
    );
    expect(await screen.findByText(webMessages.adminQueueEmpty)).toBeTruthy();
    expect(getApplications).toHaveBeenCalledWith({
      status: "under_review",
      q: "",
      page: 1,
      pageSize: 25,
    });
  });

  it("prevents repeated decline requests while the first request is pending", async () => {
    let finishDecline:
      | ((result: {
          applicationId: string;
          contractId: string;
          status: "declined";
          replayed: boolean;
        }) => void)
      | undefined;
    const declineApplication = vi.fn(
      () =>
        new Promise<{
          applicationId: string;
          contractId: string;
          status: "declined";
          replayed: boolean;
        }>((resolve) => {
          finishDecline = resolve;
        }),
    );
    const { apiClient } = setup({
      initialPath: `/admin/customers/${customerId}`,
      signedIn: true,
      declineApplication,
    });
    await screen.findByRole("heading", { name: webMessages.adminDetailTitle });
    fireEvent.click(
      await screen.findByRole("button", { name: webMessages.adminDecline }),
    );
    const confirm = screen.getByRole("button", {
      name: webMessages.adminDeclineConfirmButton,
    });
    fireEvent.click(confirm);
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.click(confirm);
    expect(declineApplication).toHaveBeenCalledOnce();

    await act(async () => {
      finishDecline?.({
        applicationId,
        contractId,
        status: "declined",
        replayed: false,
      });
    });
    expect(
      await screen.findByText(webMessages.adminDeclineSuccess),
    ).toBeTruthy();
    expect(apiClient.getCustomerDetail).toHaveBeenCalledOnce();
  });

  it("opens an application from the queue", async () => {
    const { apiClient } = setup({
      initialPath: "/admin/customers",
      signedIn: true,
    });
    fireEvent.click(await screen.findByRole("link", { name: /喫茶ひだまり/ }));
    expect(
      await screen.findByRole("heading", {
        name: webMessages.adminDetailTitle,
      }),
    ).toBeTruthy();
    expect(apiClient.getCustomerDetail).toHaveBeenCalledWith(customerId);
  });

  it("routes /admin to the protected review queue", async () => {
    const { apiClient } = setup({
      initialPath: "/admin",
      signedIn: true,
    });
    expect(await screen.findByText(queueItem.shopName)).toBeTruthy();
    expect(apiClient.getSession).toHaveBeenCalledOnce();
    expect(apiClient.getApplications).toHaveBeenCalledOnce();
  });

  it("rechecks the server session on a refreshed protected route before loading the queue", async () => {
    const getSession = vi.fn(async () => ({ role: "admin" as const }));
    const { apiClient } = setup({
      initialPath: "/admin/customers",
      signedIn: true,
      getSession,
    });
    expect(await screen.findByText(queueItem.shopName)).toBeTruthy();
    expect(getSession).toHaveBeenCalledOnce();
    expect(apiClient.getApplications).toHaveBeenCalledOnce();
  });

  it("shows an authorized admin logout control and stays authorized if SDK sign-out fails", async () => {
    const signOut = vi.fn(async () => {
      throw new Error("SDK failure");
    });
    setup({ initialPath: "/admin/customers", signedIn: true, signOut });
    expect(await screen.findByText(queueItem.shopName)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminLogout }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.logoutError,
    );
    expect(screen.getByText(queueItem.shopName)).toBeTruthy();
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("routes an authorized admin to admin login after successful logout", async () => {
    const { authClient } = setup({
      initialPath: "/admin/customers",
      signedIn: true,
    });
    expect(await screen.findByText(queueItem.shopName)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminLogout }),
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.adminLoginTitle }),
    ).toBeTruthy();
    expect(authClient.signOut).toHaveBeenCalledOnce();
  });
});
