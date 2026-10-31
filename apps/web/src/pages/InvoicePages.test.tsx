// @vitest-environment jsdom

import { webMessages } from "@kobito/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AuthClient, AuthProvider, RequireAuth } from "../auth/session.js";
import {
  type AdminApiClient,
  AdminApiError,
} from "../platform/admin-api-client.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";
import {
  AdminInvoiceDetailPage,
  AdminInvoiceListPage,
  MyInvoiceDetailPage,
  MyInvoiceListPage,
} from "./InvoicePages.js";

const invoiceId = "44444444-4444-4444-8444-444444444444";
const invoice = {
  id: invoiceId,
  invoiceNo: "INV/2026 001",
  kind: "initial" as const,
  status: "issued" as const,
  issuedOn: "2026-10-26",
  dueOn: "2026-11-02",
  totalInclTax: 5500,
  totalExclTax: 5000,
  taxAmount: 500,
  paymentMethod: "bank_transfer" as const,
  preview: true,
  acceptedPlan: {
    planId: "55555555-5555-4555-8555-555555555555",
    planCode: "light",
    planName: "ライト（申込時）",
    monthlyPriceExclTax: 5000,
    credits: 1,
  },
  billingName: "喫茶ひだまり",
  billingAddress: "東京都杉並区1-2-3",
  issuer: {
    serviceName: "受付サービス",
    companyName: "設定済み運営会社",
    companyAddress: "東京都千代田区1-1",
    invoiceRegistrationNo: "T1234567890123",
    bankAccountName: "サンプル名義",
    bankAccountBranch: "本店",
    bankAccountType: "普通",
    bankAccountNumber: "1234567",
  },
  lines: [
    {
      description: "ライトプラン 初月分",
      quantity: 1,
      unitPriceExclTax: 5000,
      amountExclTax: 5000,
      taxRate: 0.1,
    },
  ],
};

const user = {
  uid: "customer-test",
  email: "customer@example.jp",
  getIdToken: async () => "token",
};
const authClient: AuthClient = {
  currentUser: () => user,
  subscribe: (listener) => {
    queueMicrotask(() => listener(user));
    return () => undefined;
  },
  signIn: async () => user,
  signInWithCustomToken: async () => user,
  signUp: async () => user,
  signOut: async () => undefined,
};

function setup(
  page: "admin-list" | "admin-detail" | "me-list" | "me-detail",
  overrides: Record<string, ReturnType<typeof vi.fn>> = {},
) {
  const adminApiClient = {
    getInvoices: vi.fn(async () => ({ invoices: [invoice] })),
    getInvoice: vi.fn(async () => invoice),
    getInvoicePdf: vi.fn(
      async () => new Blob(["pdf"], { type: "application/pdf" }),
    ),
    ...overrides,
  } as unknown as AdminApiClient;
  const customerApiClient = adminApiClient as unknown as ReturnTypeApiClient;
  const path =
    page === "admin-detail"
      ? `/admin/invoices/${invoiceId}`
      : page === "me-detail"
        ? `/me/invoices/${invoiceId}`
        : page === "admin-list"
          ? "/admin/invoices"
          : "/me/invoices";
  const component =
    page === "admin-list" ? (
      <AdminInvoiceListPage apiClient={adminApiClient} />
    ) : page === "admin-detail" ? (
      <AdminInvoiceDetailPage apiClient={adminApiClient} />
    ) : page === "me-list" ? (
      <MyInvoiceListPage apiClient={customerApiClient} />
    ) : (
      <MyInvoiceDetailPage apiClient={customerApiClient} />
    );
  render(
    <MemoryRouter initialEntries={[path]}>
      {page.startsWith("me") ? (
        <AuthProvider client={authClient}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/me/invoices" element={component} />
              <Route path="/me/invoices/:id" element={component} />
            </Route>
          </Routes>
        </AuthProvider>
      ) : (
        <Routes>
          <Route path="/admin/invoices" element={component} />
          <Route path="/admin/invoices/:id" element={component} />
        </Routes>
      )}
    </MemoryRouter>,
  );
  return { adminApiClient, customerApiClient };
}

describe("invoice pages", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    "admin-list",
    "me-list",
  ] as const)("shows preview warning and links from the %s list", async (page) => {
    const { adminApiClient, customerApiClient } = setup(page);
    expect(
      await screen.findByRole("link", { name: /INV\/2026 001/ }),
    ).toBeTruthy();
    expect(screen.getByText(webMessages.invoicePreviewShort)).toBeTruthy();
    expect(
      page === "admin-list"
        ? adminApiClient.getInvoices
        : customerApiClient.getInvoices,
    ).toHaveBeenCalledOnce();
  });

  it.each([
    "admin-detail",
    "me-detail",
  ] as const)("shows the immutable snapshot, tax totals, bank details, and preview warning on %s", async (page) => {
    const { adminApiClient, customerApiClient } = setup(page);
    expect(
      await screen.findByText(webMessages.invoicePreviewWarning),
    ).toBeTruthy();
    expect(screen.getByText("設定済み運営会社")).toBeTruthy();
    expect(screen.getByText("東京都杉並区1-2-3")).toBeTruthy();
    expect(screen.getByText("本店")).toBeTruthy();
    expect(screen.getByText("ライトプラン 初月分")).toBeTruthy();
    expect(screen.getByText("ライト（申込時）")).toBeTruthy();
    const totals = document.querySelector(".invoice-totals");
    expect(totals?.textContent).toBe(
      `${webMessages.invoiceTotalExclTax}￥5,000${webMessages.invoiceTaxAmount}￥500${webMessages.invoiceTotalInclTax}￥5,500`,
    );
    expect(
      page === "admin-detail"
        ? adminApiClient.getInvoice
        : customerApiClient.getInvoice,
    ).toHaveBeenCalledWith(invoiceId);
  });

  it("downloads a PDF using a sanitized filename and shows a retryable failure", async () => {
    const getInvoicePdf = vi.fn(async () => new Blob(["pdf"]));
    const createObjectURL = vi.fn(() => "blob:invoice");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    let downloadedFilename = "";
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedFilename = this.download;
      });
    const { adminApiClient } = setup("admin-detail", { getInvoicePdf });
    await screen.findByText(webMessages.invoicePreviewWarning);
    const downloadButtons = await screen.findAllByRole("button", {
      name: webMessages.invoiceDownload,
    });
    const downloadButton = downloadButtons[0];
    if (!downloadButton) throw new Error("Expected a PDF download button");
    fireEvent.click(downloadButton);
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(downloadedFilename).toBe("INV_2026_001.pdf");
    expect(adminApiClient.getInvoicePdf).toHaveBeenCalledWith(invoiceId);

    getInvoicePdf.mockRejectedValueOnce(new Error("private response details"));
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.invoiceDownload }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.invoiceDownloadError,
    );
  });

  it("renders an empty list and a retry after a safe load error", async () => {
    const getInvoices = vi
      .fn()
      .mockRejectedValueOnce(new Error("private DB detail"))
      .mockResolvedValue({ invoices: [] });
    setup("me-list", { getInvoices });
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.invoiceListError,
    );
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.invoiceRetry }),
    );
    expect(await screen.findByText(webMessages.invoiceListEmpty)).toBeTruthy();
    expect(getInvoices).toHaveBeenCalledTimes(2);
  });

  it("shows an access error instead of leaving an admin invoice screen loading", async () => {
    const getInvoice = vi.fn(async () => {
      throw new AdminApiError("forbidden");
    });
    setup("admin-detail", { getInvoice });
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.invoiceDetailError,
    );
    expect(screen.queryByText(webMessages.invoiceListLoading)).toBeNull();
  });

  it("keeps customer invoice routes behind the existing auth guard", async () => {
    const signedOutClient: AuthClient = {
      ...authClient,
      currentUser: () => null,
      subscribe: (listener) => {
        queueMicrotask(() => listener(null));
        return () => undefined;
      },
    };
    render(
      <AuthProvider client={signedOutClient}>
        <MemoryRouter initialEntries={[`/me/invoices/${invoiceId}`]}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route
                path="/me/invoices/:id"
                element={<div>private invoice</div>}
              />
            </Route>
            <Route path="/login" element={<div>login page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
    expect(await screen.findByText("login page")).toBeTruthy();
    expect(screen.queryByText("private invoice")).toBeNull();
  });
});
