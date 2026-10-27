// @vitest-environment jsdom

import { webMessages } from "@kobito/shared";
import {
  act,
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
import { AdminApiError } from "../platform/admin-api-client.js";
import type { AdminApiClient } from "./AdminApp.js";
import { AdminApp } from "./AdminApp.js";

const customerId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const contractId = "33333333-3333-4333-8333-333333333333";
const invoiceId = "44444444-4444-4444-8444-444444444444";
const requestId = "99999999-9999-4999-8999-999999999999";
const invoice = {
  id: invoiceId,
  invoiceNo: "INV-2026-001",
  kind: "initial" as const,
  status: "issued" as const,
  issuedOn: "2026-10-26",
  dueOn: "2026-11-02",
  totalInclTax: 5500,
  totalExclTax: 5000,
  taxAmount: 500,
  preview: true,
  paymentMethod: "bank_transfer" as const,
};
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
    paymentMethod: "bank_transfer" as const,
    termsVersion: "terms-v1",
    privacyVersion: "privacy-v1",
    disclosureVersion: "disclosure-v1",
    consentBusinessUse: true,
    consentTerms: true,
    consentMarketing: false,
    consentPartnerShare: null,
    shownTerms: {
      planName: "ライト",
      priceInclTax: 5000,
      credits: 1,
    },
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
    approveApplication?: ReturnType<typeof vi.fn>;
    getInvoices?: ReturnType<typeof vi.fn>;
    getInvoice?: ReturnType<typeof vi.fn>;
    getInvoicePdf?: ReturnType<typeof vi.fn>;
    getInvoiceReadiness?: ReturnType<typeof vi.fn>;
    getIssuerSettings?: ReturnType<typeof vi.fn>;
    updateIssuerSettings?: ReturnType<typeof vi.fn>;
    getPendingBankTransfers?: ReturnType<typeof vi.fn>;
    confirmBankPayment?: ReturnType<typeof vi.fn>;
    getRequestContracts?: ReturnType<typeof vi.fn>;
    getAdminRequests?: ReturnType<typeof vi.fn>;
    getAdminRequest?: ReturnType<typeof vi.fn>;
    createRequest?: ReturnType<typeof vi.fn>;
    sendEstimate?: ReturnType<typeof vi.fn>;
    completeSecondFactor?: ReturnType<typeof vi.fn>;
    startSecondFactor?: ReturnType<typeof vi.fn>;
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
    startSecondFactor:
      options.startSecondFactor ?? vi.fn(async () => undefined),
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
  const apiClient = {
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
    approveApplication:
      options.approveApplication ??
      vi.fn(async () => ({
        applicationId,
        contractId,
        status: "awaiting_payment" as const,
        invoice,
        replayed: false,
      })),
    getInvoices: options.getInvoices ?? vi.fn(async () => ({ invoices: [] })),
    getInvoice:
      options.getInvoice ??
      vi.fn(async () => ({
        ...invoice,
        acceptedPlan: {
          planId: "55555555-5555-4555-8555-555555555555",
          planCode: "light",
          planName: "ライト（申込時）",
          monthlyPriceInclTax: 5500,
          credits: 1,
        },
        billingName: "喫茶ひだまり",
        billingAddress: "東京都杉並区1-2-3",
        issuer: {
          serviceName: "受付サービス",
          companyName: "運営会社",
          companyAddress: "東京都千代田区1-1",
          invoiceRegistrationNo: null,
          bankAccountName: null,
          bankAccountBranch: null,
          bankAccountType: null,
          bankAccountNumber: null,
        },
        lines: [
          {
            description: "ライトプラン 初月分",
            quantity: 1,
            unitPriceInclTax: 5500,
            amountInclTax: 5500,
            taxRate: 0.1,
          },
        ],
      })),
    getInvoicePdf:
      options.getInvoicePdf ?? vi.fn(async () => new Blob(["pdf"])),
    getInvoiceReadiness:
      options.getInvoiceReadiness ??
      vi.fn(async () => ({
        canIssue: true,
        mode: "preview" as const,
        reason: "preview_only" as const,
      })),
    getIssuerSettings:
      options.getIssuerSettings ??
      vi.fn(async () => ({
        settings: {
          serviceName: "コビトサポート",
          companyName: "",
          companyAddress: "",
          invoiceRegistrationNo: null,
          invoicePrefix: "INV",
          bankAccount: {
            bankName: "",
            branchName: "",
            accountType: "",
            accountNumber: "",
            accountHolder: "",
          },
        },
        revision: "a".repeat(64),
        issuanceReady: false,
      })),
    updateIssuerSettings:
      options.updateIssuerSettings ??
      vi.fn(async (_expectedRevision, settings) => ({
        settings,
        revision: "b".repeat(64),
        issuanceReady: false,
      })),
    getPendingBankTransfers:
      options.getPendingBankTransfers ?? vi.fn(async () => ({ items: [] })),
    confirmBankPayment:
      options.confirmBankPayment ??
      vi.fn(async () => ({
        invoiceId,
        paymentId: "77777777-7777-4777-8777-777777777777",
        amount: 5500,
        paidOn: "2026-10-26",
        contractId,
        anchorDate: "2026-10-26",
        period: {
          id: "88888888-8888-4888-8888-888888888888",
          seq: 1,
          startsOn: "2026-10-26",
          endsOn: "2026-11-25",
          priceInclTax: 5500,
          credits: 1,
        },
        preview: true,
        replayed: false,
      })),
    getRequestContracts:
      options.getRequestContracts ?? vi.fn(async () => ({ items: [] })),
    getAdminRequests:
      options.getAdminRequests ?? vi.fn(async () => ({ items: [] })),
    getAdminRequest:
      options.getAdminRequest ?? vi.fn(async () => ({ id: requestId })),
    createRequest:
      options.createRequest ?? vi.fn(async () => ({ id: requestId })),
    sendEstimate:
      options.sendEstimate ?? vi.fn(async () => ({ id: invoiceId })),
  } as unknown as AdminApiClient;
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
  const input = await screen.findByLabelText(webMessages.adminMfaTotpCodeLabel);
  const submit = screen.getByRole("button", {
    name: webMessages.adminMfaCodeSubmit,
  });
  await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false));
  fireEvent.change(input, { target: { value: "123456" } });
  fireEvent.click(submit);
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

  it("waits for the MFA challenge to start before enabling code submission", async () => {
    let resolveChallenge!: () => void;
    const startSecondFactor = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveChallenge = resolve;
        }),
    );
    const completeSecondFactor = vi.fn(async () => undefined);
    setup({ startSecondFactor, completeSecondFactor });
    await fillLogin();
    await screen.findByRole("heading", {
      name: webMessages.adminMfaChallengeTitle,
    });
    await waitFor(() => expect(startSecondFactor).toHaveBeenCalledOnce());
    expect(
      screen
        .getByRole("button", { name: webMessages.adminMfaCodeSubmit })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(completeSecondFactor).not.toHaveBeenCalled();

    const finishing = finishMfa();
    await act(async () => resolveChallenge());
    await finishing;
    expect(completeSecondFactor).toHaveBeenCalledWith("totp-1", "123456");
  });

  it("requires input, preview acknowledgement, a review step, and a final confirm", async () => {
    const getPendingBankTransfers = vi.fn(async () => ({
      items: [
        {
          invoice,
          customer: {
            id: customerId,
            shopName: "喫茶ひだまり",
            billingName: "山田太郎",
          },
          contractId,
        },
      ],
    }));
    const confirmBankPayment = vi.fn(async () => ({
      invoiceId,
      paymentId: "77777777-7777-4777-8777-777777777777",
      amount: 5500,
      paidOn: "2026-10-26",
      contractId,
      anchorDate: "2026-10-26",
      period: {
        id: "88888888-8888-4888-8888-888888888888",
        seq: 1 as const,
        startsOn: "2026-10-26",
        endsOn: "2026-11-25",
        priceInclTax: 5500,
        credits: 1,
      },
      preview: true,
      replayed: false,
    }));
    setup({
      initialPath: "/admin/bank-transfers",
      signedIn: true,
      getPendingBankTransfers,
      confirmBankPayment,
    });

    expect(await screen.findByText("喫茶ひだまり")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.bankTransferConfirm }),
    );
    expect(
      screen.getByLabelText(webMessages.bankTransferPreviewAck),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: webMessages.bankTransferReview })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText(webMessages.bankTransferAmount), {
      target: { value: "5500" },
    });
    fireEvent.change(screen.getByLabelText(webMessages.bankTransferDate), {
      target: { value: "2026-10-26" },
    });
    fireEvent.click(screen.getByLabelText(webMessages.bankTransferPreviewAck));
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.bankTransferReview }),
    );
    expect(confirmBankPayment).not.toHaveBeenCalled();
    expect(
      screen.getByText(/喫茶ひだまり.*INV-2026-001.*5,500円.*2026-10-26/),
    ).toBeTruthy();
    fireEvent.click(
      within(
        screen.getByRole("region", {
          name: webMessages.bankTransferFinalTitle,
        }),
      ).getByRole("button", { name: webMessages.bankTransferConfirm }),
    );
    await waitFor(() =>
      expect(confirmBankPayment).toHaveBeenCalledWith(invoiceId, {
        amount: 5500,
        paidOn: "2026-10-26",
        previewAcknowledged: true,
      }),
    );
    expect(
      await screen.findByText(webMessages.bankTransferSuccessPreview),
    ).toBeTruthy();
  });

  it("shows a safe error after a wrong MFA code and never opens the queue", async () => {
    const { apiClient } = setup({
      completeSecondFactor: vi.fn(async () => {
        throw new Error("auth/invalid-verification-code");
      }),
    });
    await fillLogin();
    await finishMfa();
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

  it("does not approve until confirmed and then shows the issued invoice instead of stale actions", async () => {
    const { apiClient } = setup({
      initialPath: `/admin/customers/${customerId}`,
      signedIn: true,
    });
    await screen.findByRole("heading", { name: webMessages.adminDetailTitle });

    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminApprove }),
    );
    expect(
      screen.getByText(webMessages.adminApprovePreviewConfirm),
    ).toBeTruthy();
    expect(screen.getByText(webMessages.invoicePreviewWarning)).toBeTruthy();
    expect(apiClient.approveApplication).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminDeclineCancel }),
    );
    expect(apiClient.approveApplication).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminApprove }),
    );
    const confirm = screen.getByRole("button", {
      name: webMessages.adminApproveConfirmButton,
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(apiClient.approveApplication).toHaveBeenCalledOnce(),
    );
    expect(apiClient.approveApplication).toHaveBeenCalledWith(applicationId);
    expect(
      await screen.findByText(webMessages.adminApprovePreviewSuccess),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: invoice.invoiceNo })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: webMessages.adminDecline }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: webMessages.adminApprove }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: invoice.invoiceNo }));
    expect(
      await screen.findByText(webMessages.invoicePreviewWarning),
    ).toBeTruthy();
  });

  it("disables repeated approval while the first request is pending", async () => {
    let finishApproval:
      | ((result: {
          applicationId: string;
          contractId: string;
          status: "awaiting_payment";
          invoice: typeof invoice;
          replayed: boolean;
        }) => void)
      | undefined;
    const approveApplication = vi.fn(
      () =>
        new Promise<{
          applicationId: string;
          contractId: string;
          status: "awaiting_payment";
          invoice: typeof invoice;
          replayed: boolean;
        }>((resolve) => {
          finishApproval = resolve;
        }),
    );
    setup({
      initialPath: `/admin/customers/${customerId}`,
      signedIn: true,
      approveApplication,
    });
    await screen.findByRole("heading", { name: webMessages.adminDetailTitle });
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminApprove }),
    );
    const confirm = screen.getByRole("button", {
      name: webMessages.adminApproveConfirmButton,
    });
    fireEvent.click(confirm);
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.click(confirm);
    expect(approveApplication).toHaveBeenCalledOnce();
    await act(async () => {
      finishApproval?.({
        applicationId,
        contractId,
        status: "awaiting_payment",
        invoice,
        replayed: false,
      });
    });
    expect(
      await screen.findByText(webMessages.adminApprovePreviewSuccess),
    ).toBeTruthy();
  });

  it("shows the server configuration error without pretending an invoice was issued", async () => {
    const approveApplication = vi.fn(async () => {
      throw new AdminApiError("invoice_unavailable");
    });
    const { apiClient } = setup({
      initialPath: `/admin/customers/${customerId}`,
      signedIn: true,
      approveApplication,
    });
    await screen.findByRole("heading", { name: webMessages.adminDetailTitle });
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminApprove }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: webMessages.adminApproveConfirmButton,
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.invoiceUnavailable,
    );
    expect(apiClient.approveApplication).toHaveBeenCalledOnce();
    expect(screen.queryByText(webMessages.adminApproveSuccess)).toBeNull();
  });

  it("blocks fixed-price approval when readiness says live invoice settings are unavailable", async () => {
    const approveApplication = vi.fn();
    const { apiClient } = setup({
      initialPath: `/admin/customers/${customerId}`,
      signedIn: true,
      approveApplication,
      getInvoiceReadiness: vi.fn(async () => ({
        canIssue: false,
        mode: "unavailable" as const,
        reason: "issuer_not_configured" as const,
      })),
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.invoiceUnavailable,
    );
    expect(apiClient.approveApplication).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: webMessages.adminApprove }),
    ).toBeNull();
  });

  it("fails closed when the admin invoice readiness request fails", async () => {
    const approveApplication = vi.fn();
    setup({
      initialPath: `/admin/customers/${customerId}`,
      signedIn: true,
      approveApplication,
      getInvoiceReadiness: vi.fn(async () => {
        throw new AdminApiError("forbidden");
      }),
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.invoiceReadinessError,
    );
    expect(approveApplication).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: webMessages.adminApprove }),
    ).toBeNull();
  });

  it("uses the quote path for a custom application and creates no invoice link", async () => {
    const customDetail = {
      ...detail,
      application: {
        ...detail.application,
        shownTerms: {
          planName: "個別見積り",
          priceInclTax: null,
          credits: null,
        },
      },
    };
    const approveApplication = vi.fn(async () => ({
      applicationId,
      contractId,
      status: "quoting" as const,
      invoice: null,
      replayed: false,
    }));
    setup({
      initialPath: `/admin/customers/${customerId}`,
      signedIn: true,
      getCustomerDetail: vi.fn(async () => customDetail),
      approveApplication,
    });
    await screen.findByRole("heading", { name: webMessages.adminDetailTitle });
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminApproveCustom }),
    );
    expect(screen.getByText(webMessages.adminQuoteConfirm)).toBeTruthy();
    expect(screen.queryByText(webMessages.adminApproveConfirm)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminQuoteConfirmButton }),
    );
    expect(await screen.findByText(webMessages.adminQuoteSuccess)).toBeTruthy();
    expect(approveApplication).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: invoice.invoiceNo })).toBeNull();
    expect(
      screen.queryByRole("button", { name: webMessages.adminApproveCustom }),
    ).toBeNull();
  });

  it("does not offer a custom quote action for a non-bank application", async () => {
    const customDetail = {
      ...detail,
      application: {
        ...detail.application,
        paymentMethod: "card" as const,
        shownTerms: {
          planName: "個別見積り",
          priceInclTax: null,
          credits: null,
        },
      },
    };
    const approveApplication = vi.fn();
    setup({
      initialPath: `/admin/customers/${customerId}`,
      signedIn: true,
      getCustomerDetail: vi.fn(async () => customDetail),
      approveApplication,
    });

    expect(
      await screen.findByRole("heading", {
        name: webMessages.adminDetailTitle,
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(webMessages.adminInvoicePaymentUnsupported),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: webMessages.adminApproveCustom }),
    ).toBeNull();
    expect(approveApplication).not.toHaveBeenCalled();
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

  it("lets an MFA-authorized admin edit issuer settings and explains readiness and invoice snapshots", async () => {
    const { apiClient } = setup({
      initialPath: "/admin/settings",
      signedIn: true,
    });
    expect(
      await screen.findByRole("heading", { name: "発行者・振込先設定" }),
    ).toBeTruthy();
    expect(
      await screen.findByText(webMessages.adminIssuerSettingsNotReady),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "変更後に発行する請求書へ反映されます。発行済み請求書の内容は変わりません。",
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("会社名"), {
      target: { value: "合同会社ひだまり" },
    });
    fireEvent.change(screen.getByLabelText("会社住所"), {
      target: { value: "東京都杉並区1-2-3" },
    });
    fireEvent.change(screen.getByLabelText("銀行名"), {
      target: { value: "みずほ銀行" },
    });
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));
    await waitFor(() =>
      expect(apiClient.updateIssuerSettings).toHaveBeenCalledWith(
        "a".repeat(64),
        expect.objectContaining({
          companyName: "合同会社ひだまり",
          bankAccount: expect.objectContaining({ bankName: "みずほ銀行" }),
        }),
      ),
    );
  });

  it("surfaces stale settings and offers an explicit reload without overwriting", async () => {
    type SettingsResponse = Awaited<
      ReturnType<AdminApiClient["getIssuerSettings"]>
    >;
    let resolveSettings!: (response: SettingsResponse) => void;
    const getIssuerSettings = vi
      .fn<() => Promise<SettingsResponse>>()
      .mockImplementationOnce(
        () =>
          new Promise<SettingsResponse>((resolve) => {
            resolveSettings = resolve;
          }),
      )
      .mockResolvedValueOnce({
        settings: {
          serviceName: "コビトサポート",
          companyName: "",
          companyAddress: "",
          invoiceRegistrationNo: null,
          invoicePrefix: "INV",
          bankAccount: {
            bankName: "",
            branchName: "",
            accountType: "",
            accountNumber: "",
            accountHolder: "",
          },
        },
        revision: "a".repeat(64),
        issuanceReady: false,
      });
    const updateIssuerSettings = vi.fn(async () => {
      throw new AdminApiError("issuer_settings_conflict");
    });
    const { apiClient } = setup({
      initialPath: "/admin/settings",
      signedIn: true,
      getIssuerSettings,
      updateIssuerSettings,
    });
    await screen.findByRole("heading", { name: "発行者・振込先設定" });
    expect(
      screen.getByText(webMessages.adminIssuerSettingsLoading),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "設定を保存" })).toBeNull();
    await waitFor(() => expect(getIssuerSettings).toHaveBeenCalledOnce());
    await act(async () => {
      resolveSettings({
        settings: {
          serviceName: "コビトサポート",
          companyName: "",
          companyAddress: "",
          invoiceRegistrationNo: null,
          invoicePrefix: "INV",
          bankAccount: {
            bankName: "",
            branchName: "",
            accountType: "",
            accountNumber: "",
            accountHolder: "",
          },
        },
        revision: "a".repeat(64),
        issuanceReady: false,
      });
    });
    fireEvent.change(await screen.findByLabelText("会社名"), {
      target: { value: "ローカル編集" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "設定を保存" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "別の管理者が設定を更新しました。最新の設定を読み込み直してください。",
    );
    expect(
      screen.getByRole("button", { name: "最新の設定を読み込む" }),
    ).toBeTruthy();
    expect((screen.getByLabelText("会社名") as HTMLInputElement).value).toBe(
      "ローカル編集",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "最新の設定を読み込む" }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("会社名") as HTMLInputElement).value).toBe(
        "",
      ),
    );
    expect(apiClient.getIssuerSettings).toHaveBeenCalledTimes(2);
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

  it("offers request registration from an active customer detail with the selected contract", async () => {
    setup({
      initialPath: `/admin/customers/${customerId}`,
      signedIn: true,
      getCustomerDetail: vi.fn(async () => ({
        ...detail,
        contract: { id: contractId, status: "active" as const },
      })),
    });
    const registration = await screen.findByRole("link", {
      name: webMessages.adminRequestsNew,
    });
    expect(registration.getAttribute("href")).toBe(
      `/admin/requests/new?contractId=${contractId}`,
    );
  });
});
