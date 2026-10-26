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
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthClient } from "../auth/admin-session.js";
import type { AuthClient } from "../auth/session.js";
import { AuthProvider, RequireAuth } from "../auth/session.js";
import type { AdminApiClient } from "../platform/admin-api-client.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";
import { ApiClientError } from "../platform/api-client.js";
import { AdminApp } from "./AdminApp.js";
import { MyRequestDetailPage, MyRequestsPage } from "./RequestPages.js";

const contractId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const estimateId = "44444444-4444-4444-8444-444444444444";
const periodId = "55555555-5555-4555-8555-555555555555";
const estimate = {
  id: estimateId,
  requestId,
  version: 1,
  credits: 1,
  dueOn: "2026-10-30",
  workItems: ["予約フォームの表示を整える"],
  doneCriteria: "スマートフォンで予約フォームを送信できる",
  exclusions: null,
  customerPrep: null,
  sentAt: "2026-10-26T00:00:00.000Z",
  approvedAt: null,
  supersededAt: null,
};
const adminRequest = {
  id: requestId,
  contractId,
  receivedOn: "2026-10-26",
  summary: "予約フォームの表示を直したい",
  urgent: false,
  status: "awaiting_approval" as const,
  createdAt: "2026-10-26T00:00:00.000Z",
  latestEstimate: estimate,
  customer: { customerId, shopName: "喫茶ひだまり", contactName: "山田 花子" },
  estimates: [estimate],
};
const customerRequest = {
  ...adminRequest,
  approvedEstimateId: null,
};

afterEach(cleanup);

function adminSetup(
  path = "/admin/requests",
  overrides: Record<string, unknown> = {},
) {
  const user = {
    email: "admin@example.jp",
    getIdToken: vi.fn(async () => "admin-token"),
  };
  const authClient: AdminAuthClient = {
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
    getSession: vi.fn(async () => ({ role: "admin" as const })),
    getAdminRequests: vi.fn(async () => ({ items: [adminRequest] })),
    getAdminRequest: vi.fn(async () => adminRequest),
    getRequestContracts: vi.fn(async () => ({
      items: [
        {
          contractId,
          customerId,
          shopName: "喫茶ひだまり",
          contactName: "山田 花子",
          status: "active" as const,
        },
      ],
    })),
    createRequest: vi.fn(async () => ({
      ...adminRequest,
      status: "received" as const,
    })),
    sendEstimate: vi.fn(async () => ({ ...estimate, version: 2 })),
    ...overrides,
  } as unknown as AdminApiClient;
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/admin/*"
          element={<AdminApp authClient={authClient} apiClient={apiClient} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return { apiClient, authClient };
}

function customerSetup(path: string, overrides: Record<string, unknown> = {}) {
  const user = {
    email: "customer@example.jp",
    getIdToken: vi.fn(async () => "customer-token"),
  };
  const authClient: AuthClient = {
    currentUser: () => user,
    subscribe: (listener) => {
      queueMicrotask(() => listener(user));
      return () => undefined;
    },
    signIn: vi.fn(async () => undefined),
    signUp: vi.fn(async () => user),
    signOut: vi.fn(async () => undefined),
  };
  const apiClient = {
    getCustomerRequests: vi.fn(async () => ({ items: [customerRequest] })),
    getCustomerRequest: vi.fn(async () => ({
      request: customerRequest,
      latestEstimate: estimate,
      currentPeriodId: periodId,
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
    ...overrides,
  } as unknown as ReturnTypeApiClient;
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider client={authClient}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route
              path="/me/requests"
              element={<MyRequestsPage apiClient={apiClient} />}
            />
            <Route
              path="/me/requests/:id"
              element={<MyRequestDetailPage apiClient={apiClient} />}
            />
          </Route>
          <Route path="/login" element={<p>sign-in required</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return { apiClient, authClient };
}

describe("request and estimate routes", () => {
  it("loads the admin queue in the protected nested admin router and navigates to registration", async () => {
    const { apiClient } = adminSetup();
    expect(
      await screen.findByRole("heading", {
        name: webMessages.adminRequestsTitle,
      }),
    ).toBeTruthy();
    expect(await screen.findByText(adminRequest.summary)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: webMessages.adminRequestsNew }),
    ).toBeTruthy();
    expect(apiClient.getAdminRequests).toHaveBeenCalledOnce();
  });

  it("requires contract selection and required estimate fields, then sends with an idempotency key", async () => {
    const { apiClient } = adminSetup(
      `/admin/requests/new?contractId=${contractId}`,
      {
        getAdminRequest: vi.fn(async () => ({
          ...adminRequest,
          status: "received" as const,
          latestEstimate: null,
          estimates: [],
        })),
      },
    );
    expect(
      await screen.findByRole("heading", {
        name: webMessages.adminRequestsNew,
      }),
    ).toBeTruthy();
    fireEvent.change(
      await screen.findByLabelText(webMessages.adminRequestSummary),
      { target: { value: "予約フォームの修正" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminRequestsCreate }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      webMessages.requestValidationError,
    );
    expect(apiClient.createRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(webMessages.adminRequestCustomer), {
      target: { value: contractId },
    });
    fireEvent.change(
      screen.getByLabelText(webMessages.adminRequestReceivedOn),
      { target: { value: "2026-10-26" } },
    );
    const registerButton = screen.getByRole("button", {
      name: webMessages.adminRequestsCreate,
    });
    fireEvent.click(registerButton);
    fireEvent.click(registerButton);
    await screen.findByRole("heading", {
      name: webMessages.adminRequestEstimate,
    });
    expect(apiClient.createRequest).toHaveBeenCalledOnce();
    const estimateSendButton = screen.getByRole("button", {
      name: webMessages.adminEstimateSend,
    });
    fireEvent.click(estimateSendButton);
    expect((await screen.findByRole("alert")).textContent).toBe(
      webMessages.requestValidationError,
    );
    fireEvent.change(screen.getByLabelText(webMessages.adminEstimateCredits), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(webMessages.adminEstimateDueOn), {
      target: { value: "2026-10-30" },
    });
    fireEvent.change(screen.getByLabelText(/作業内容/), {
      target: { value: "予約フォームの表示を整える" },
    });
    fireEvent.change(
      screen.getByLabelText(webMessages.adminEstimateDoneCriteria),
      { target: { value: "スマートフォンで送信できる" } },
    );
    fireEvent.click(estimateSendButton);
    fireEvent.click(estimateSendButton);
    await waitFor(() => expect(apiClient.sendEstimate).toHaveBeenCalledOnce());
    const [, payload, key] =
      vi.mocked(apiClient.sendEstimate).mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      credits: 1,
      workItems: ["予約フォームの表示を整える"],
    });
    expect(key).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("shows immutable earlier versions while revising an awaiting estimate", async () => {
    const older = {
      ...estimate,
      version: 1,
      id: "66666666-6666-4666-8666-666666666666",
      workItems: ["以前の作業内容"],
    };
    const current = { ...estimate, version: 2, workItems: ["現在の作業内容"] };
    const detail = {
      ...adminRequest,
      estimates: [older, current],
      latestEstimate: current,
    };
    const { apiClient } = adminSetup(`/admin/requests/${requestId}`, {
      getAdminRequest: vi.fn(async () => detail),
    });
    expect(await screen.findByText("以前の作業内容")).toBeTruthy();
    expect(screen.getByText("現在の作業内容")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: webMessages.adminEstimateRevise }),
    ).toBeTruthy();
    expect(apiClient.getAdminRequest).toHaveBeenCalledWith(requestId);
  });

  it("sends a revised estimate as a new version while retaining the earlier content", async () => {
    const old = {
      ...estimate,
      id: "66666666-6666-4666-8666-666666666666",
      workItems: ["以前の作業内容"],
      version: 1,
      supersededAt: "2026-10-26T01:00:00.000Z",
    };
    const latest = { ...estimate, version: 2, workItems: ["現在の作業内容"] };
    const revision = {
      ...estimate,
      id: "77777777-7777-4777-8777-777777777777",
      version: 3,
      workItems: ["変更後の作業内容"],
    };
    const before = {
      ...adminRequest,
      estimates: [old, latest],
      latestEstimate: latest,
    };
    const after = {
      ...adminRequest,
      estimates: [old, latest, revision],
      latestEstimate: revision,
    };
    const getAdminRequest = vi
      .fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const sendEstimate = vi.fn(async () => revision);
    const { apiClient } = adminSetup(`/admin/requests/${requestId}`, {
      getAdminRequest,
      sendEstimate,
    });
    expect(await screen.findByText("以前の作業内容")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminEstimateRevise }),
    );
    expect(screen.getByLabelText(/作業内容/).textContent).toBe(
      "現在の作業内容",
    );
    fireEvent.change(screen.getByLabelText(/作業内容/), {
      target: { value: "変更後の作業内容" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminEstimateRevise }),
    );
    expect(await screen.findByText("変更後の作業内容")).toBeTruthy();
    expect(screen.getByText("以前の作業内容")).toBeTruthy();
    expect(apiClient.sendEstimate).toHaveBeenCalledOnce();
    expect(apiClient.sendEstimate).toHaveBeenCalledWith(
      requestId,
      expect.objectContaining({ workItems: ["変更後の作業内容"] }),
      expect.any(String),
    );
  });

  it("does not offer a second send when a successful estimate cannot be refreshed", async () => {
    const createdEstimate = { ...estimate, version: 1 };
    const createdRequest = {
      ...adminRequest,
      status: "received" as const,
      latestEstimate: null,
      estimates: [],
    };
    const currentRequest = {
      ...adminRequest,
      status: "awaiting_approval" as const,
      latestEstimate: createdEstimate,
      estimates: [createdEstimate],
    };
    const getAdminRequest = vi
      .fn()
      .mockResolvedValueOnce(createdRequest)
      .mockRejectedValueOnce(new Error("temporary read failure"))
      .mockResolvedValueOnce(currentRequest);
    const sendEstimate = vi.fn(async () => createdEstimate);
    const { apiClient } = adminSetup(`/admin/requests/${requestId}`, {
      getAdminRequest,
      sendEstimate,
    });
    fireEvent.change(
      await screen.findByLabelText(webMessages.adminEstimateCredits),
      { target: { value: "1" } },
    );
    fireEvent.change(screen.getByLabelText(webMessages.adminEstimateDueOn), {
      target: { value: "2026-10-30" },
    });
    fireEvent.change(screen.getByLabelText(/作業内容/), {
      target: { value: "予約フォームの表示を整える" },
    });
    fireEvent.change(
      screen.getByLabelText(webMessages.adminEstimateDoneCriteria),
      { target: { value: "スマートフォンで送信できる" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminEstimateSend }),
    );
    expect(
      await screen.findByText(webMessages.adminEstimateSentRefreshError),
    ).toBeTruthy();
    expect(apiClient.sendEstimate).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: webMessages.adminEstimateSend }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: webMessages.retry }));
    expect(await screen.findByText("予約フォームの表示を整える")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: webMessages.adminEstimateRevise }),
    ).toBeTruthy();
    expect(sendEstimate).toHaveBeenCalledOnce();
  });

  it("does not offer estimate revisions after the customer has approved and work is underway", async () => {
    const { apiClient } = adminSetup(`/admin/requests/${requestId}`, {
      getAdminRequest: vi.fn(async () => ({
        ...adminRequest,
        status: "in_progress" as const,
      })),
    });
    expect(await screen.findByText("予約フォームの表示を整える")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: webMessages.adminEstimateRevise }),
    ).toBeNull();
    expect(apiClient.sendEstimate).not.toHaveBeenCalled();
  });

  it("lets a customer review an estimate, cancel confirmation, then approve only after confirming", async () => {
    const pastTargetEstimate = { ...estimate, dueOn: "2025-01-01" };
    const updatedRequest = {
      ...customerRequest,
      status: "in_progress" as const,
      approvedEstimateId: estimateId,
    };
    const getCustomerRequest = vi
      .fn()
      .mockResolvedValueOnce({
        request: customerRequest,
        latestEstimate: pastTargetEstimate,
        currentPeriodId: periodId,
        availableCredits: 2,
        canApprove: true,
      })
      .mockResolvedValueOnce({
        request: updatedRequest,
        latestEstimate: { ...estimate, approvedAt: "2026-10-26T01:00:00.000Z" },
        currentPeriodId: periodId,
        availableCredits: 1,
        canApprove: false,
      });
    const { apiClient } = customerSetup(`/me/requests/${requestId}`, {
      getCustomerRequest,
    });
    expect(await screen.findByText("予約フォームの表示を整える")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.myRequestApprove }),
    );
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.myRequestCancel }),
    );
    expect(apiClient.approveEstimate).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.myRequestApprove }),
    );
    const approvalButton = within(screen.getByRole("dialog")).getByRole(
      "button",
      { name: webMessages.myRequestApprove },
    );
    fireEvent.click(approvalButton);
    fireEvent.click(approvalButton);
    expect(
      await screen.findByText(webMessages.myRequestApprovalSuccess),
    ).toBeTruthy();
    expect(apiClient.approveEstimate).toHaveBeenCalledOnce();
    expect(apiClient.approveEstimate).toHaveBeenCalledWith(estimateId);
    await screen.findByText(webMessages.myRequestApprovalSuccess);
    expect(
      screen.getByText(webMessages.myRequestAvailableCredits).nextElementSibling
        ?.textContent,
    ).toBe(`1 ${webMessages.requestCreditUnit}`);
    expect(getCustomerRequest).toHaveBeenCalledTimes(2);
  });

  it("offers LINE contact when the current credit balance is insufficient", async () => {
    const { apiClient } = customerSetup(`/me/requests/${requestId}`, {
      getCustomerRequest: vi.fn(async () => ({
        request: customerRequest,
        latestEstimate: estimate,
        currentPeriodId: periodId,
        availableCredits: 0,
        canApprove: false,
      })),
      approveEstimate: vi.fn(),
    });
    expect(
      await screen.findByText(webMessages.myRequestInsufficientCredits),
    ).toBeTruthy();
    expect(screen.getByText(webMessages.myRequestContactLine)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: webMessages.myRequestApprove }),
    ).toBeNull();
    expect(apiClient.approveEstimate).not.toHaveBeenCalled();
  });

  it("shows a refreshable conflict after a stale approval and avoids duplicate approval while busy", async () => {
    let rejectApproval: ((error: Error) => void) | undefined;
    const approveEstimate = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectApproval = reject;
        }),
    );
    const getCustomerRequest = vi.fn(async () => ({
      request: customerRequest,
      latestEstimate: estimate,
      currentPeriodId: periodId,
      availableCredits: 2,
      canApprove: true,
    }));
    customerSetup(`/me/requests/${requestId}`, {
      approveEstimate,
      getCustomerRequest,
    });
    expect(await screen.findByText("予約フォームの表示を整える")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.myRequestApprove }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: webMessages.myRequestApprove,
      }),
    );
    await waitFor(() => expect(approveEstimate).toHaveBeenCalledOnce());
    expect(
      within(dialog)
        .getByRole("button", { name: webMessages.requestSendBusy })
        .hasAttribute("disabled"),
    ).toBe(true);
    rejectApproval?.(new ApiClientError("estimate_conflict"));
    expect(await screen.findByText(webMessages.myRequestConflict)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: webMessages.retry }),
    ).toBeTruthy();
    expect(getCustomerRequest).toHaveBeenCalledTimes(2);
  });
});
