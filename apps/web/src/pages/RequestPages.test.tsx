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
import {
  type AdminApiClient,
  AdminApiError,
} from "../platform/admin-api-client.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";
import { ApiClientError } from "../platform/api-client.js";
import { ContactProvider } from "../platform/contact.js";
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
  completion: null,
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

function customerSetup(
  path: string,
  overrides: Record<string, unknown> = {},
  contact: { lineEnabled: boolean; contactEmail: string | null } = {
    lineEnabled: true,
    contactEmail: null,
  },
) {
  const user = {
    uid: "customer-test",
    email: "customer@example.jp",
    getIdToken: vi.fn(async () => "customer-token"),
  };
  const authClient: AuthClient = {
    currentUser: () => user,
    subscribe: (listener) => {
      queueMicrotask(() => listener(user));
      return () => undefined;
    },
    signIn: vi.fn(async () => user),
    signInWithCustomToken: vi.fn(async () => user),
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
      <ContactProvider value={contact}>
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
      </ContactProvider>
    </MemoryRouter>,
  );
  return { apiClient, authClient };
}

async function fillCompletionForm(
  actualMinutes: number,
  actualCredits: number,
) {
  expect(
    await screen.findByLabelText(webMessages.adminRequestCompletedOn),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText(webMessages.adminRequestCompletedOn), {
    target: { value: "2026-10-27" },
  });
  fireEvent.change(
    screen.getByLabelText(webMessages.adminRequestActualMinutes),
    { target: { value: String(actualMinutes) } },
  );
  fireEvent.change(
    screen.getByLabelText(webMessages.adminRequestActualCredits),
    { target: { value: String(actualCredits) } },
  );
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

  it("offers completion entry for an in-progress request with separate time and credit actuals", async () => {
    const { apiClient } = adminSetup(`/admin/requests/${requestId}`, {
      getAdminRequest: vi.fn(async () => ({
        ...adminRequest,
        status: "in_progress" as const,
      })),
    });

    expect(await screen.findByText("予約フォームの表示を整える")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: webMessages.adminRequestComplete }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(webMessages.adminRequestCompletedOn),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(webMessages.adminRequestActualMinutes),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(webMessages.adminRequestActualCredits),
    ).toBeTruthy();
    expect(apiClient.getAdminRequest).toHaveBeenCalledWith(requestId);
  });

  it.each([
    0, 1, 2,
  ])("records %i actual credits separately from actual minutes after explicit confirmation", async (actualCredits) => {
    const completed = {
      ...adminRequest,
      status: "done" as const,
      completion: {
        completedOn: "2026-10-27",
        actualMinutes: 45,
        actualCredits,
        reservedCredits: 1,
        periodId,
        reservedPeriod: { startsOn: "2026-10-01", endsOn: "2026-10-31" },
      },
    };
    const getAdminRequest = vi.fn().mockResolvedValueOnce({
      ...adminRequest,
      status: "in_progress" as const,
    });
    const completeRequest = vi.fn(async () => ({
      requestId,
      status: "done" as const,
      ...completed.completion,
      replayed: false,
    }));
    const { apiClient } = adminSetup(`/admin/requests/${requestId}`, {
      getAdminRequest,
      completeRequest,
    });
    expect(
      await screen.findByLabelText(webMessages.adminRequestCompletedOn),
    ).toBeTruthy();
    fireEvent.change(
      screen.getByLabelText(webMessages.adminRequestCompletedOn),
      {
        target: { value: "2026-10-27" },
      },
    );
    fireEvent.change(
      screen.getByLabelText(webMessages.adminRequestActualMinutes),
      {
        target: { value: "45" },
      },
    );
    fireEvent.change(
      screen.getByLabelText(webMessages.adminRequestActualCredits),
      {
        target: { value: String(actualCredits) },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminRequestComplete }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(adminRequest.summary)).toBeTruthy();
    expect(within(dialog).getByText(/喫茶ひだまり（山田 花子）/)).toBeTruthy();
    expect(within(dialog).getAllByText("1 クレジット").length).toBeGreaterThan(
      0,
    );
    if (actualCredits > 1) {
      expect(
        within(dialog).getByText(webMessages.adminRequestActualExceedsEstimate),
      ).toBeTruthy();
    }
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: webMessages.adminRequestComplete,
      }),
    );
    expect(await screen.findByText(webMessages.adminRequestCompletionSuccess));
    expect(completeRequest).toHaveBeenCalledOnce();
    expect(completeRequest).toHaveBeenCalledWith(requestId, {
      completedOn: "2026-10-27",
      actualMinutes: 45,
      actualCredits,
    });
    expect(
      screen.getByText(webMessages.adminRequestActualMinutes).nextElementSibling
        ?.textContent,
    ).toContain("45");
    expect(screen.getByText("2026-10-27", { exact: true })).toBeTruthy();
    expect(
      screen.getByText(webMessages.adminRequestReservedPeriod),
    ).toBeTruthy();
    if (actualCredits > 1) {
      expect(
        screen.getByText(webMessages.adminRequestActualExceedsEstimate),
      ).toBeTruthy();
    }
    expect(apiClient.getAdminRequest).toHaveBeenCalledOnce();
  });

  it("cancels completion confirmation without mutation and prevents double submit while busy", async () => {
    let resolveCompletion: ((value: unknown) => void) | undefined;
    const completeRequest = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCompletion = resolve;
        }),
    );
    adminSetup(`/admin/requests/${requestId}`, {
      getAdminRequest: vi.fn(async () => ({
        ...adminRequest,
        status: "in_progress" as const,
      })),
      completeRequest,
    });
    expect(
      await screen.findByLabelText(webMessages.adminRequestCompletedOn),
    ).toBeTruthy();
    await fillCompletionForm(0, 0);
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminRequestComplete }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "戻る" }));
    expect(completeRequest).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminRequestComplete }),
    );
    const confirmation = await screen.findByRole("dialog");
    const confirmButton = within(confirmation).getByRole("button", {
      name: webMessages.adminRequestComplete,
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    await waitFor(() => expect(completeRequest).toHaveBeenCalledOnce());
    expect(confirmButton.hasAttribute("disabled")).toBe(true);
    resolveCompletion?.({
      requestId,
      status: "done",
      completedOn: "2026-10-27",
      actualMinutes: 0,
      actualCredits: 0,
      reservedCredits: 1,
      periodId,
      reservedPeriod: { startsOn: "2026-10-01", endsOn: "2026-10-31" },
      replayed: false,
    });
  });

  it.each([
    "2026-10-25",
    "9999-12-31",
  ])("rejects completion date %s outside the received-to-Tokyo-today range", async (invalidDate) => {
    const completeRequest = vi.fn();
    adminSetup(`/admin/requests/${requestId}`, {
      getAdminRequest: vi.fn(async () => ({
        ...adminRequest,
        status: "in_progress" as const,
      })),
      completeRequest,
    });
    expect(
      await screen.findByLabelText(webMessages.adminRequestCompletedOn),
    ).toBeTruthy();
    fireEvent.change(
      screen.getByLabelText(webMessages.adminRequestCompletedOn),
      {
        target: { value: invalidDate },
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
    expect(
      screen.getAllByText(webMessages.adminRequestCompletionValidation).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(completeRequest).not.toHaveBeenCalled();
  });

  it("retries the identical completion payload after a network error", async () => {
    const completed = {
      ...adminRequest,
      status: "done" as const,
      completion: {
        completedOn: "2026-10-27",
        actualMinutes: 45,
        actualCredits: 1,
        reservedCredits: 1,
        periodId,
        reservedPeriod: { startsOn: "2026-10-01", endsOn: "2026-10-31" },
      },
    };
    const getAdminRequest = vi
      .fn()
      .mockResolvedValueOnce({
        ...adminRequest,
        status: "in_progress" as const,
      })
      .mockResolvedValueOnce(completed);
    const response = {
      requestId,
      status: "done" as const,
      ...completed.completion,
      replayed: false,
    };
    const completeRequest = vi
      .fn()
      .mockRejectedValueOnce(new AdminApiError("network"))
      .mockResolvedValueOnce(response);
    adminSetup(`/admin/requests/${requestId}`, {
      getAdminRequest,
      completeRequest,
    });
    await fillCompletionForm(45, 1);
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminRequestComplete }),
    );
    const dialog = await screen.findByRole("dialog");
    const confirm = () =>
      within(screen.getByRole("dialog")).getByRole("button", {
        name: webMessages.adminRequestComplete,
      });
    fireEvent.click(confirm());
    expect(
      await within(dialog).findByText(webMessages.requestActionError),
    ).toBeTruthy();
    fireEvent.click(confirm());
    expect(
      await screen.findByText(webMessages.adminRequestCompletionSuccess),
    ).toBeTruthy();
    expect(completeRequest).toHaveBeenCalledTimes(2);
    expect(completeRequest.mock.calls[0]).toEqual(
      completeRequest.mock.calls[1],
    );
  });

  it("refreshes completed state after a completion conflict", async () => {
    const completed = {
      ...adminRequest,
      status: "done" as const,
      completion: {
        completedOn: "2026-10-27",
        actualMinutes: 15,
        actualCredits: 1,
        reservedCredits: 1,
        periodId,
        reservedPeriod: { startsOn: "2026-10-01", endsOn: "2026-10-31" },
      },
    };
    const getAdminRequest = vi
      .fn()
      .mockResolvedValueOnce({
        ...adminRequest,
        status: "in_progress" as const,
      })
      .mockResolvedValueOnce(completed);
    const completeRequest = vi.fn(async () => {
      throw new AdminApiError("request_conflict");
    });
    adminSetup(`/admin/requests/${requestId}`, {
      getAdminRequest,
      completeRequest,
    });
    await fillCompletionForm(15, 1);
    fireEvent.click(
      screen.getByRole("button", { name: webMessages.adminRequestComplete }),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: webMessages.adminRequestComplete,
      }),
    );
    expect(
      await screen.findByText(webMessages.adminRequestCompletionConflict),
    ).toBeTruthy();
    expect(screen.getByText("2026-10-27", { exact: true })).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: webMessages.adminRequestComplete,
      }),
    ).toBeNull();
    expect(getAdminRequest).toHaveBeenCalledTimes(2);
  });

  it("shows a completed customer's actual completion details as read-only", async () => {
    const completedRequest = {
      ...customerRequest,
      status: "done" as const,
      completion: {
        completedOn: "2026-10-27",
        actualMinutes: 45,
        actualCredits: 1,
        reservedCredits: 1,
        periodId,
        reservedPeriod: { startsOn: "2026-10-01", endsOn: "2026-10-31" },
      },
    };
    customerSetup(`/me/requests/${requestId}`, {
      getCustomerRequest: vi.fn(async () => ({
        request: completedRequest,
        latestEstimate: estimate,
        currentPeriodId: periodId,
        availableCredits: 2,
        canApprove: false,
      })),
    });
    expect(await screen.findByText("2026-10-27", { exact: true })).toBeTruthy();
    expect(
      screen.getByText(webMessages.myRequestCompletionActualMinutes),
    ).toBeTruthy();
    expect(
      screen.getByText(webMessages.myRequestCompletionActualCredits),
    ).toBeTruthy();
    expect(
      screen.getByText(webMessages.myRequestCompletionActualMinutes)
        .nextElementSibling?.textContent,
    ).toContain("45");
    expect(
      screen.getByText(webMessages.myRequestCompletionActualCredits)
        .nextElementSibling?.textContent,
    ).toContain("1");
    expect(
      screen.queryByRole("button", { name: webMessages.adminRequestComplete }),
    ).toBeNull();
  });

  it("shows actual completion credits and date in the customer's own request history", async () => {
    const completedRequest = {
      ...customerRequest,
      status: "done" as const,
      completion: {
        completedOn: "2026-10-27",
        actualMinutes: 45,
        actualCredits: 0,
        reservedCredits: 1,
        periodId,
        reservedPeriod: { startsOn: "2026-10-01", endsOn: "2026-10-31" },
      },
    };
    customerSetup("/me/requests", {
      getCustomerRequests: vi.fn(async () => ({ items: [completedRequest] })),
    });
    expect(await screen.findByText(completedRequest.summary)).toBeTruthy();
    expect(screen.getByText("2026-10-27")).toBeTruthy();
    expect(
      screen.getByText(webMessages.myRequestCompletionActualCredits)
        .nextElementSibling?.textContent,
    ).toContain("0");
    expect(screen.queryByText(webMessages.estimateCredits)).toBeNull();
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

  it("offers email contact instead of LINE when the LINE flag is off", async () => {
    customerSetup(
      `/me/requests/${requestId}`,
      {
        getCustomerRequest: vi.fn(async () => ({
          request: customerRequest,
          latestEstimate: estimate,
          currentPeriodId: periodId,
          availableCredits: 0,
          canApprove: false,
        })),
      },
      { lineEnabled: false, contactEmail: "hello@contact.example" },
    );
    expect(
      await screen.findByText(webMessages.myRequestInsufficientCreditsEmail),
    ).toBeTruthy();
    expect(screen.queryByText(webMessages.myRequestContactLine)).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "hello@contact.example" })
        .getAttribute("href"),
    ).toBe("mailto:hello@contact.example");
    expect(document.body.textContent).not.toContain("LINE");
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
