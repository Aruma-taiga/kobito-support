// @vitest-environment jsdom

import { webMessages } from "@kobito/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import type { AdminAuthClient } from "./auth/admin-session.js";
import type { AuthClient, AuthUser } from "./auth/session.js";
import type { AdminApiClient } from "./platform/admin-api-client.js";
import type { ReturnTypeApiClient } from "./platform/api-client.js";
import { ApiClientError } from "./platform/api-client.js";

const requestId = "33333333-3333-4333-8333-333333333333";
const estimateId = "44444444-4444-4444-8444-444444444444";
const request = {
  id: requestId,
  contractId: "11111111-1111-4111-8111-111111111111",
  receivedOn: "2026-10-26",
  summary: "予約フォームの修正",
  urgent: false,
  status: "awaiting_approval" as const,
  createdAt: "2026-10-26T00:00:00.000Z",
  latestEstimate: {
    id: estimateId,
    requestId,
    version: 1,
    credits: 1,
    dueOn: "2026-10-30",
    workItems: ["予約フォームの表示を整える"],
    doneCriteria: "スマートフォンで送信できる",
    exclusions: null,
    customerPrep: null,
    sentAt: "2026-10-26T00:00:00.000Z",
    approvedAt: null,
    supersededAt: null,
  },
  completion: null,
  approvedEstimateId: null,
};

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

function setup(
  path: string,
  adminOverrides: Record<string, unknown> = {},
  customerOverrides: Record<string, unknown> = {},
  authUserOverrides: Partial<AuthUser> = {},
) {
  window.history.replaceState({}, "", path);
  const user: AuthUser = {
    uid: "customer-a",
    email: "person@example.jp",
    getIdToken: vi.fn(async () => "id-token"),
    ...authUserOverrides,
  };
  let currentUser: AuthUser | null = user;
  let authStateListener: ((next: AuthUser | null) => void) | null = null;
  const signOut = vi.fn(async () => {
    currentUser = null;
    authStateListener?.(null);
  });
  const authClient: AuthClient = {
    currentUser: () => currentUser,
    subscribe: (listener) => {
      authStateListener = listener;
      queueMicrotask(() => listener(currentUser));
      return () => undefined;
    },
    signIn: vi.fn(async () => undefined),
    signUp: vi.fn(async () => user),
    signOut,
  };
  const adminAuthClient: AdminAuthClient = {
    currentUser: () => user,
    subscribe: (listener) => {
      queueMicrotask(() => listener(user));
      return () => undefined;
    },
    signIn: vi.fn(async () => ({ status: "signed_in" as const })),
    startSecondFactor: vi.fn(async () => undefined),
    completeSecondFactor: vi.fn(async () => undefined),
    cancelSecondFactor: vi.fn(),
    signOut: vi.fn(async () => undefined),
  };
  const apiClient = {
    getPublicConfig: vi.fn(async () => ({ serviceName: "コビトサポート" })),
    getMe: vi.fn(async () => ({
      customer: {
        id: "22222222-2222-4222-8222-222222222222",
        shopName: "喫茶ひだまり",
        contactName: "山田 花子",
      },
    })),
    getContract: vi.fn(async () => ({ contract: null })),
    getCustomerRequests: vi.fn(async () => ({ items: [request] })),
    getCustomerRequest: vi.fn(async () => ({
      request,
      latestEstimate: request.latestEstimate,
      currentPeriodId: "55555555-5555-4555-8555-555555555555",
      availableCredits: 2,
      canApprove: true,
    })),
    approveEstimate: vi.fn(async () => ({
      requestId,
      estimateId,
      status: "in_progress" as const,
      approvedAt: "2026-10-26T01:00:00.000Z",
      reservedCredits: 1,
      replayed: false,
    })),
    getCustomerAccess: vi.fn(async () => ({
      contractStatus: "active",
      landingPath: "/me",
      access: "active",
      welcomeRequired: false,
      invoiceAccess: true,
      invoiceAccessUntil: null,
    })),
    markWelcomeSeen: vi.fn(async () => ({
      seenAt: "2026-10-27T00:00:00.000Z",
    })),
    getInvoices: vi.fn(async () => ({ invoices: [] })),
    ...customerOverrides,
  } as unknown as ReturnTypeApiClient;
  const adminApiClient = {
    getSession: vi.fn(async () => ({ role: "admin" as const })),
    getAdminRequests: vi.fn(async () => ({ items: [] })),
    getAdminRequest: vi.fn(async () => ({
      ...request,
      status: "in_progress" as const,
      customer: {
        customerId: "22222222-2222-4222-8222-222222222222",
        shopName: "喫茶ひだまり",
        contactName: "山田 花子",
      },
      estimates: [request.latestEstimate],
    })),
    ...adminOverrides,
  } as unknown as AdminApiClient;
  render(
    <App
      apiClient={apiClient}
      authClient={authClient}
      adminApiClient={adminApiClient}
      adminAuthClient={adminAuthClient}
    />,
  );
  return {
    apiClient,
    adminApiClient,
    signOut,
    setAuthUser(next: AuthUser | null) {
      currentUser = next;
      authStateListener?.(next);
    },
  };
}

describe("application request routes", () => {
  it("lets a pending customer sign out from the waiting page without loading profile data", async () => {
    const { apiClient, signOut } = setup(
      "/me",
      {},
      {
        getCustomerAccess: vi.fn(async () => ({
          contractStatus: "under_review",
          landingPath: "/me/waiting",
          access: "pending",
          welcomeRequired: false,
          invoiceAccess: true,
          invoiceAccessUntil: null,
        })),
      },
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.meWaitingTitle }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: webMessages.logout }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", { name: webMessages.loginTitle }),
    ).toBeTruthy();
    expect(apiClient.getMe).not.toHaveBeenCalled();
    expect(apiClient.getContract).not.toHaveBeenCalled();
    expect(apiClient.getCustomerRequests).not.toHaveBeenCalled();
    expect(apiClient.markWelcomeSeen).not.toHaveBeenCalled();
  });

  it("lets an ended customer sign out from retained invoice history", async () => {
    const { apiClient, signOut } = setup(
      "/me/invoices",
      {},
      {
        getCustomerAccess: vi.fn(async () => ({
          contractStatus: "ended",
          landingPath: "/me/invoices",
          access: "ended",
          welcomeRequired: false,
          invoiceAccess: true,
          invoiceAccessUntil: "2027-10-27",
        })),
      },
    );
    expect(
      await screen.findByRole("heading", {
        name: webMessages.invoiceListTitle,
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: webMessages.logout }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", { name: webMessages.loginTitle }),
    ).toBeTruthy();
    expect(apiClient.getMe).not.toHaveBeenCalled();
    expect(apiClient.getContract).not.toHaveBeenCalled();
    expect(apiClient.getCustomerRequests).not.toHaveBeenCalled();
    expect(apiClient.markWelcomeSeen).not.toHaveBeenCalled();
  });

  it("lets a customer sign out without acknowledging the welcome screen", async () => {
    const { apiClient, signOut } = setup(
      "/me",
      {},
      {
        getCustomerAccess: vi.fn(async () => ({
          contractStatus: "active",
          landingPath: "/me/welcome",
          access: "active",
          welcomeRequired: true,
          invoiceAccess: true,
          invoiceAccessUntil: null,
        })),
      },
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.meWelcomeTitle }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: webMessages.logout }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", { name: webMessages.loginTitle }),
    ).toBeTruthy();
    expect(apiClient.markWelcomeSeen).not.toHaveBeenCalled();
    expect(apiClient.getMe).not.toHaveBeenCalled();
  });

  it("shows a failed sign-out and allows retry from a waiting page", async () => {
    const { signOut } = setup(
      "/me",
      {},
      {
        getCustomerAccess: vi.fn(async () => ({
          contractStatus: "under_review",
          landingPath: "/me/waiting",
          access: "pending",
          welcomeRequired: false,
          invoiceAccess: false,
          invoiceAccessUntil: null,
        })),
      },
    );
    signOut.mockRejectedValueOnce(new Error("sign-out unavailable"));
    expect(
      await screen.findByRole("heading", { name: webMessages.meWaitingTitle }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: webMessages.logout }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      webMessages.logoutError,
    );
    fireEvent.click(screen.getByRole("button", { name: webMessages.logout }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(webMessages.logoutError)).toBeNull();
  });

  it("hides the previous customer's data while a new UID's access check is pending", async () => {
    let resolveSecondAccess: ((value: unknown) => void) | undefined;
    const pendingAccess = {
      contractStatus: "under_review",
      landingPath: "/me/waiting",
      access: "pending",
      welcomeRequired: false,
      invoiceAccess: false,
      invoiceAccessUntil: null,
    };
    const getCustomerAccess = vi
      .fn()
      .mockResolvedValue(pendingAccess)
      .mockResolvedValueOnce({
        contractStatus: "active",
        landingPath: "/me",
        access: "active",
        welcomeRequired: false,
        invoiceAccess: true,
        invoiceAccessUntil: null,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondAccess = resolve;
          }),
      );
    const { apiClient, setAuthUser } = setup(
      "/me",
      {},
      { getCustomerAccess },
      { email: null },
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.homeTitle }),
    ).toBeTruthy();
    expect(await screen.findByText("喫茶ひだまり")).toBeTruthy();

    setAuthUser({
      uid: "customer-b",
      email: null,
      getIdToken: vi.fn(async () => "second-customer-token"),
    });

    await waitFor(() => expect(getCustomerAccess).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("喫茶ひだまり")).toBeNull();
    expect(apiClient.getMe).toHaveBeenCalledOnce();
    resolveSecondAccess?.(pendingAccess);
    expect(
      await screen.findByRole("heading", { name: webMessages.meWaitingTitle }),
    ).toBeTruthy();
    expect(apiClient.getMe).toHaveBeenCalledOnce();
  });

  it("rechecks access on customer navigation before loading newly forbidden business data", async () => {
    const getCustomerAccess = vi
      .fn()
      .mockResolvedValueOnce({
        contractStatus: "active",
        landingPath: "/me",
        access: "active",
        welcomeRequired: false,
        invoiceAccess: true,
        invoiceAccessUntil: null,
      })
      .mockResolvedValue({
        contractStatus: "ended",
        landingPath: "/me/invoices",
        access: "ended",
        welcomeRequired: false,
        invoiceAccess: true,
        invoiceAccessUntil: "2027-10-27",
      });
    const { apiClient } = setup("/me", {}, { getCustomerAccess });
    expect(
      await screen.findByRole("heading", { name: webMessages.homeTitle }),
    ).toBeTruthy();

    fireEvent.click(
      await screen.findByRole("link", { name: webMessages.myRequestsTitle }),
    );

    expect(
      await screen.findByRole("heading", {
        name: webMessages.invoiceListTitle,
      }),
    ).toBeTruthy();
    expect(getCustomerAccess).toHaveBeenCalledTimes(3);
    expect(apiClient.getCustomerRequests).not.toHaveBeenCalled();
    expect(apiClient.getMe).toHaveBeenCalledOnce();
  });

  it("routes a customer under review to the waiting page before loading profile data", async () => {
    const getCustomerAccess = vi.fn(async () => ({
      contractStatus: "under_review",
      landingPath: "/me/waiting",
      access: "pending",
      welcomeRequired: false,
      invoiceAccess: false,
      invoiceAccessUntil: null,
    }));
    const { apiClient } = setup("/me", {}, { getCustomerAccess });
    expect(
      await screen.findByRole("heading", { name: webMessages.meWaitingTitle }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe("/me/waiting");
    expect(screen.queryByText("喫茶ひだまり")).toBeNull();
    expect(apiClient.getMe).not.toHaveBeenCalled();
    expect(apiClient.getContract).not.toHaveBeenCalled();
    expect(apiClient.getInvoices).not.toHaveBeenCalled();
  });

  it.each([
    "under_review",
    "quoting",
  ] as const)("keeps %s customers on waiting guidance with invoice history only", async (contractStatus) => {
    const { apiClient } = setup(
      "/me",
      {},
      {
        getCustomerAccess: vi.fn(async () => ({
          contractStatus,
          landingPath: "/me/waiting",
          access: "pending",
          welcomeRequired: false,
          invoiceAccess: true,
          invoiceAccessUntil: null,
        })),
        getContract: vi.fn(async () => {
          throw new Error("pending customers cannot read contract data");
        }),
      },
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.meWaitingTitle }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("link", { name: webMessages.invoiceListTitle }),
    ).toBeTruthy();
    expect(apiClient.getInvoices).not.toHaveBeenCalled();
    expect(apiClient.getMe).not.toHaveBeenCalled();
  });

  it("shows the invoice route to an awaiting-payment customer without exposing profile actions", async () => {
    const { apiClient } = setup(
      "/me",
      {},
      {
        getCustomerAccess: vi.fn(async () => ({
          contractStatus: "awaiting_payment",
          landingPath: "/me/waiting",
          access: "pending",
          welcomeRequired: false,
          invoiceAccess: true,
          invoiceAccessUntil: null,
        })),
      },
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.meWaitingTitle }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: webMessages.invoiceListTitle }),
    ).toBeTruthy();
    expect(apiClient.getInvoices).not.toHaveBeenCalled();
    expect(apiClient.getMe).not.toHaveBeenCalled();
    expect(apiClient.getCustomerRequests).not.toHaveBeenCalled();
  });

  it("shows the welcome page once, records acknowledgement, then enters the home page", async () => {
    const activeWelcome = {
      contractStatus: "active",
      landingPath: "/me/welcome",
      access: "active",
      welcomeRequired: true,
      invoiceAccess: true,
      invoiceAccessUntil: null,
    };
    const activeSeen = {
      ...activeWelcome,
      landingPath: "/me",
      welcomeRequired: false,
    };
    const getCustomerAccess = vi
      .fn()
      .mockResolvedValueOnce(activeWelcome)
      .mockResolvedValueOnce(activeWelcome)
      .mockResolvedValue(activeSeen);
    const markWelcomeSeen = vi.fn(async () => ({
      seenAt: "2026-10-27T00:00:00.000Z",
    }));
    const { apiClient } = setup(
      "/me",
      {},
      { getCustomerAccess, markWelcomeSeen },
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.meWelcomeTitle }),
    ).toBeTruthy();
    expect(screen.getByText(webMessages.meWelcomeDescription)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /LINE/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.meWelcomeContinue }),
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.homeTitle }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe("/me");
    expect(markWelcomeSeen).toHaveBeenCalledOnce();
    expect(getCustomerAccess).toHaveBeenCalledTimes(3);
    expect(apiClient.getMe).toHaveBeenCalledOnce();
  });

  it("does not show welcome again when the active customer's welcome was already seen", async () => {
    const { apiClient } = setup("/me");
    expect(
      await screen.findByRole("heading", { name: webMessages.homeTitle }),
    ).toBeTruthy();
    expect(screen.queryByText(webMessages.meWelcomeTitle)).toBeNull();
    expect(apiClient.markWelcomeSeen).not.toHaveBeenCalled();
  });

  it.each([
    "declined",
    "lapsed",
  ] as const)("shows only the finished message for a %s customer", async (contractStatus) => {
    const { apiClient } = setup(
      "/me",
      {},
      {
        getCustomerAccess: vi.fn(async () => ({
          contractStatus,
          landingPath: "/me/finished",
          access: "finished",
          welcomeRequired: false,
          invoiceAccess: false,
          invoiceAccessUntil: null,
        })),
        getContract: vi.fn(async () => {
          throw new Error("legacy account has no contract endpoint access");
        }),
      },
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.meFinishedTitle }),
    ).toBeTruthy();
    expect(screen.queryByText("喫茶ひだまり")).toBeNull();
    expect(apiClient.getMe).not.toHaveBeenCalled();
    expect(apiClient.getContract).not.toHaveBeenCalled();
    expect(apiClient.getInvoices).not.toHaveBeenCalled();
  });

  it("allows ended customers to see invoices only, never profile or request routes", async () => {
    const { apiClient } = setup(
      "/me/requests",
      {},
      {
        getCustomerAccess: vi.fn(async () => ({
          contractStatus: "ended",
          landingPath: "/me/invoices",
          access: "ended",
          welcomeRequired: false,
          invoiceAccess: true,
          invoiceAccessUntil: "2027-10-27",
        })),
      },
    );
    expect(
      await screen.findByRole("heading", {
        name: webMessages.invoiceListTitle,
      }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe("/me/invoices");
    expect(apiClient.getInvoices).toHaveBeenCalledOnce();
    expect(apiClient.getMe).not.toHaveBeenCalled();
    expect(apiClient.getContract).not.toHaveBeenCalled();
    expect(apiClient.getCustomerRequests).not.toHaveBeenCalled();
  });

  it("keeps expired ended customers out of the invoice list", async () => {
    const { apiClient } = setup(
      "/me/invoices",
      {},
      {
        getCustomerAccess: vi.fn(async () => ({
          contractStatus: "ended",
          landingPath: "/me/finished",
          access: "finished",
          welcomeRequired: false,
          invoiceAccess: false,
          invoiceAccessUntil: null,
        })),
      },
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.meFinishedTitle }),
    ).toBeTruthy();
    expect(apiClient.getInvoices).not.toHaveBeenCalled();
    expect(apiClient.getMe).not.toHaveBeenCalled();
  });

  it("keeps legacy customers with no contract on the existing profile page", async () => {
    const { apiClient } = setup(
      "/me",
      {},
      {
        getCustomerAccess: vi.fn(async () => ({
          contractStatus: null,
          landingPath: "/me",
          access: "none",
          welcomeRequired: false,
          invoiceAccess: false,
          invoiceAccessUntil: null,
        })),
        getContract: vi.fn(async () => {
          throw new Error("legacy account has no contract endpoint access");
        }),
      },
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.homeTitle }),
    ).toBeTruthy();
    expect(await screen.findByText("喫茶ひだまり")).toBeTruthy();
    expect(apiClient.getMe).toHaveBeenCalledOnce();
    expect(apiClient.getContract).not.toHaveBeenCalled();
    expect(apiClient.getCustomerRequests).not.toHaveBeenCalled();
    expect(apiClient.getInvoices).not.toHaveBeenCalled();
  });

  it("keeps protected customer pages closed on access failure and offers retry/logout", async () => {
    const getCustomerAccess = vi
      .fn()
      .mockRejectedValueOnce(new Error("access unavailable"))
      .mockResolvedValue({
        contractStatus: null,
        landingPath: "/me",
        access: "none",
        welcomeRequired: false,
        invoiceAccess: false,
        invoiceAccessUntil: null,
      });
    const { apiClient } = setup("/me", {}, { getCustomerAccess });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: webMessages.retry }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: webMessages.logout }),
    ).toBeTruthy();
    expect(screen.queryByText("喫茶ひだまり")).toBeNull();
    expect(apiClient.getMe).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: webMessages.retry }));
    expect(
      await screen.findByRole("heading", { name: webMessages.homeTitle }),
    ).toBeTruthy();
    expect(getCustomerAccess).toHaveBeenCalledTimes(2);
  });

  it("shows a not-found response for a customer role mismatch without loading customer data", async () => {
    const { apiClient } = setup(
      "/me",
      {},
      {
        getCustomerAccess: vi.fn(async () => {
          throw new ApiClientError("not_found");
        }),
      },
    );
    expect(await screen.findByText(webMessages.accessNotFound)).toBeTruthy();
    expect(apiClient.getMe).not.toHaveBeenCalled();
    expect(apiClient.getContract).not.toHaveBeenCalled();
    expect(apiClient.getInvoices).not.toHaveBeenCalled();
  });

  it("navigates from the real customer home through the request list to the estimate", async () => {
    const { apiClient } = setup("/me");
    fireEvent.click(
      await screen.findByRole("link", { name: webMessages.myRequestsTitle }),
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.myRequestsTitle }),
    ).toBeTruthy();
    fireEvent.click(await screen.findByRole("link", { name: request.summary }));
    expect(await screen.findByText("予約フォームの表示を整える")).toBeTruthy();
    expect(apiClient.getCustomerRequests).toHaveBeenCalledOnce();
    expect(apiClient.getCustomerRequest).toHaveBeenCalledWith(requestId);
  });

  it("loads admin requests through the root /admin/* route with the authorized session", async () => {
    const { adminApiClient } = setup("/admin/requests");
    expect(
      await screen.findByRole("heading", {
        name: webMessages.adminRequestsTitle,
      }),
    ).toBeTruthy();
    expect(adminApiClient.getSession).toHaveBeenCalledOnce();
    expect(adminApiClient.getAdminRequests).toHaveBeenCalledOnce();
  });

  it("shows the completion action through the real protected root admin route", async () => {
    const { adminApiClient } = setup(`/admin/requests/${requestId}`);
    expect(await screen.findByText("予約フォームの表示を整える")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "依頼を完了にする" }),
    ).toBeTruthy();
    expect(adminApiClient.getSession).toHaveBeenCalledOnce();
    expect(adminApiClient.getAdminRequest).toHaveBeenCalledWith(requestId);
  });

  it("confirms and records completion through the protected root admin route", async () => {
    const completed = {
      requestId,
      status: "done" as const,
      completedOn: "2026-10-27",
      actualMinutes: 0,
      actualCredits: 0,
      reservedCredits: 1,
      periodId: "55555555-5555-4555-8555-555555555555",
      reservedPeriod: { startsOn: "2026-10-01", endsOn: "2026-10-31" },
      replayed: false,
    };
    const completeRequest = vi.fn(async () => completed);
    const { adminApiClient } = setup(`/admin/requests/${requestId}`, {
      completeRequest,
    });
    expect(
      await screen.findByLabelText(webMessages.adminRequestCompletedOn),
    ).toBeTruthy();
    fireEvent.change(
      screen.getByLabelText(webMessages.adminRequestCompletedOn),
      {
        target: { value: completed.completedOn },
      },
    );
    fireEvent.change(
      screen.getByLabelText(webMessages.adminRequestActualMinutes),
      { target: { value: "0" } },
    );
    fireEvent.change(
      screen.getByLabelText(webMessages.adminRequestActualCredits),
      { target: { value: "0" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminRequestComplete }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: webMessages.adminRequestComplete,
      }),
    );
    expect(
      await screen.findByText(webMessages.adminRequestCompletionSuccess),
    ).toBeTruthy();
    expect(adminApiClient.getSession).toHaveBeenCalledOnce();
    expect(completeRequest).toHaveBeenCalledWith(requestId, {
      completedOn: completed.completedOn,
      actualMinutes: 0,
      actualCredits: 0,
    });
  });

  it("reloads the home contract when returning after estimate approval", async () => {
    const { apiClient } = setup("/me");
    expect(
      await screen.findByRole("heading", { name: webMessages.homeTitle }),
    ).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("link", { name: webMessages.myRequestsTitle }),
    );
    fireEvent.click(await screen.findByRole("link", { name: request.summary }));
    fireEvent.click(
      await screen.findByRole("button", { name: webMessages.myRequestApprove }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: webMessages.myRequestApprove,
      }),
    );
    expect(
      await screen.findByText(webMessages.myRequestApprovalSuccess),
    ).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("link", { name: webMessages.myRequestsTitle }),
    );
    fireEvent.click(
      await screen.findByRole("link", { name: webMessages.homeTitle }),
    );
    await screen.findByRole("heading", { name: webMessages.homeTitle });
    await waitFor(() => expect(apiClient.getContract).toHaveBeenCalledTimes(2));
  });
});
