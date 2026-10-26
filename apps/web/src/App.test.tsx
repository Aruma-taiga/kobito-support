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
import type { AuthClient } from "./auth/session.js";
import type { AdminApiClient } from "./platform/admin-api-client.js";
import type { ReturnTypeApiClient } from "./platform/api-client.js";

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
  approvedEstimateId: null,
};

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

function setup(path: string) {
  window.history.replaceState({}, "", path);
  const user = {
    email: "person@example.jp",
    getIdToken: vi.fn(async () => "id-token"),
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
  } as unknown as ReturnTypeApiClient;
  const adminApiClient = {
    getSession: vi.fn(async () => ({ role: "admin" as const })),
    getAdminRequests: vi.fn(async () => ({ items: [] })),
  } as unknown as AdminApiClient;
  render(
    <App
      apiClient={apiClient}
      authClient={authClient}
      adminApiClient={adminApiClient}
      adminAuthClient={adminAuthClient}
    />,
  );
  return { apiClient, adminApiClient };
}

describe("application request routes", () => {
  it("navigates from the real customer home through the request list to the estimate", async () => {
    const { apiClient } = setup("/me");
    fireEvent.click(
      await screen.findByRole("link", { name: webMessages.myRequestsTitle }),
    );
    expect(
      await screen.findByRole("heading", { name: webMessages.myRequestsTitle }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: request.summary }));
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
