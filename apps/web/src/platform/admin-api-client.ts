import {
  type AdminApplicationQueueQuery,
  type AdminApplicationQueueResponse,
  type AdminCancellation,
  type AdminCustomerDetail,
  type AdminInvoiceDetail,
  type AdminIssuerSettings,
  type AdminIssuerSettingsResponse,
  type AdminNotificationFailuresResponse,
  type AdminPaymentReviewsResponse,
  type AdminPlanQuote,
  type AdminReferralsResponse,
  type AdminRequestDetail,
  type AdminRequestSummary,
  type AdminSession,
  adminApplicationQueueQuerySchema,
  adminApplicationQueueResponseSchema,
  adminCancellationSchema,
  adminCustomerDetailSchema,
  adminInvoiceDetailSchema,
  adminIssuerSettingsResponseSchema,
  adminNotificationFailureRetryResponseSchema,
  adminNotificationFailuresResponseSchema,
  adminPaymentReviewResolveRequestSchema,
  adminPaymentReviewResolveResponseSchema,
  adminPaymentReviewsResponseSchema,
  adminPlanQuoteSchema,
  adminReferralsQuerySchema,
  adminReferralsResponseSchema,
  adminRequestDetailSchema,
  adminRequestListSchema,
  adminSessionSchema,
  approveApplicationResponseSchema,
  type CompleteRequest,
  type CompleteRequestResponse,
  type ConfirmBankPaymentRequest,
  type CreateEstimate,
  type CreatePlanQuote,
  type CreatePlanQuoteResponse,
  type CreateRequest,
  completeRequestResponseSchema,
  completeRequestSchema,
  confirmBankPaymentRequestSchema,
  confirmBankPaymentResponseSchema,
  createEstimateResponseSchema,
  createEstimateSchema,
  createPlanQuoteResponseSchema,
  createRequestResponseSchema,
  createRequestSchema,
  type DeclineApplicationRequest,
  type DeclineApplicationResponse,
  declineApplicationRequestSchema,
  declineApplicationResponseSchema,
  type EligibleRequestContracts,
  eligibleRequestContractsSchema,
  type InvoiceList,
  type InvoiceReadiness,
  invoiceListSchema,
  invoiceReadinessSchema,
  type PayReferralRewardsRequest,
  type PayReferralRewardsResponse,
  payReferralRewardsRequestSchema,
  payReferralRewardsResponseSchema,
  pendingBankTransfersSchema,
  type RequestEstimate,
  type RetentionItem,
  retentionListSchema,
  type UpdateCancellationChecklist,
  updateAdminIssuerSettingsRequestSchema,
  updateCancellationChecklistSchema,
  voidInvoiceRequestSchema,
} from "@kobito/shared";

export interface AdminApiAuthUser {
  getIdToken(): Promise<string>;
}

export type AdminApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_error"
  | "network"
  | "server"
  | "invoice_unavailable"
  | "request_conflict"
  | "estimate_conflict"
  | "insufficient_credits"
  | "plan_quote_conflict"
  | "invalid_response"
  | "issuer_settings_conflict";

export class AdminApiError extends Error {
  constructor(readonly code: AdminApiErrorCode) {
    super(code);
  }
}

export interface AdminApiClientOptions {
  baseUrl: string;
  getCurrentUser(): AdminApiAuthUser | null;
  fetcher?: typeof fetch;
}

export function createAdminApiClient(options: AdminApiClientOptions) {
  const fetcher = options.fetcher ?? fetch;

  async function request<T>(
    endpoint: string,
    schema: {
      safeParse(data: unknown): { success: true; data: T } | { success: false };
    },
    init?: RequestInit,
  ): Promise<T> {
    const user = options.getCurrentUser();
    if (!user) throw new AdminApiError("unauthorized");

    let token: string;
    try {
      token = await user.getIdToken();
    } catch {
      throw new AdminApiError("unauthorized");
    }

    let response: Response;
    try {
      response = await fetcher(new URL(endpoint, options.baseUrl), {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${token}`,
          ...init?.headers,
        },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new AdminApiError("network");
    }

    if (!response.ok) {
      let responseCode: string | undefined;
      try {
        const payload = (await response.clone().json()) as {
          error?: { code?: unknown };
        };
        if (typeof payload.error?.code === "string") {
          responseCode = payload.error.code;
        }
      } catch {
        responseCode = undefined;
      }
      if (responseCode === "settings_revision_conflict") {
        throw new AdminApiError("issuer_settings_conflict");
      }
      if (
        responseCode === "request_conflict" ||
        responseCode === "estimate_conflict" ||
        responseCode === "insufficient_credits" ||
        responseCode === "plan_quote_conflict"
      ) {
        throw new AdminApiError(responseCode);
      }
      const codes: Record<number, AdminApiErrorCode> = {
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        422: "validation_error",
        503: "invoice_unavailable",
      };
      throw new AdminApiError(codes[response.status] ?? "server");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AdminApiError("invalid_response");
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new AdminApiError("invalid_response");
    return parsed.data;
  }

  async function requestBlob(endpoint: string): Promise<Blob> {
    const user = options.getCurrentUser();
    if (!user) throw new AdminApiError("unauthorized");
    let token: string;
    try {
      token = await user.getIdToken();
    } catch {
      throw new AdminApiError("unauthorized");
    }
    let response: Response;
    try {
      response = await fetcher(new URL(endpoint, options.baseUrl), {
        headers: {
          Accept: "application/pdf",
          Authorization: `Bearer ${token}`,
        },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new AdminApiError("network");
    }
    if (!response.ok) {
      const codes: Record<number, AdminApiErrorCode> = {
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
      };
      throw new AdminApiError(codes[response.status] ?? "server");
    }
    if (
      response.headers.get("content-type")?.split(";")[0]?.trim() !==
      "application/pdf"
    ) {
      throw new AdminApiError("invalid_response");
    }
    try {
      return await response.blob();
    } catch {
      throw new AdminApiError("invalid_response");
    }
  }

  return {
    getSession(): Promise<AdminSession> {
      return request("/api/v1/admin/session", adminSessionSchema);
    },
    getIssuerSettings(): Promise<AdminIssuerSettingsResponse> {
      return request(
        "/api/v1/admin/settings",
        adminIssuerSettingsResponseSchema,
      );
    },
    updateIssuerSettings(
      expectedRevision: string,
      settings: AdminIssuerSettings,
    ): Promise<AdminIssuerSettingsResponse> {
      const parsed = updateAdminIssuerSettingsRequestSchema.safeParse({
        expectedRevision,
        settings,
      });
      if (!parsed.success) throw new AdminApiError("validation_error");
      return request(
        "/api/v1/admin/settings",
        adminIssuerSettingsResponseSchema,
        {
          method: "PUT",
          body: JSON.stringify(parsed.data),
        },
      );
    },
    getRetention(): Promise<RetentionItem[]> {
      return request("/api/v1/admin/retention", retentionListSchema);
    },
    getAdminReferrals(month?: string): Promise<AdminReferralsResponse> {
      const parsed = adminReferralsQuerySchema.safeParse(
        month === undefined ? {} : { month },
      );
      if (!parsed.success) throw new AdminApiError("validation_error");
      const search = parsed.data.month
        ? `?month=${encodeURIComponent(parsed.data.month)}`
        : "";
      return request(
        `/api/v1/admin/referrals${search}`,
        adminReferralsResponseSchema,
      );
    },
    payAdminReferralRewards(
      input: PayReferralRewardsRequest,
    ): Promise<PayReferralRewardsResponse> {
      const parsed = payReferralRewardsRequestSchema.safeParse(input);
      if (!parsed.success) throw new AdminApiError("validation_error");
      return request(
        "/api/v1/admin/referrals/payments",
        payReferralRewardsResponseSchema,
        {
          method: "POST",
          body: JSON.stringify(parsed.data),
        },
      );
    },
    getApplications(
      query: Partial<AdminApplicationQueueQuery> = {},
    ): Promise<AdminApplicationQueueResponse> {
      const parsed = adminApplicationQueueQuerySchema.safeParse(query);
      if (!parsed.success) throw new AdminApiError("validation_error");
      const search = new URLSearchParams();
      if (parsed.data.status) search.set("status", parsed.data.status);
      if (parsed.data.q) search.set("q", parsed.data.q);
      search.set("page", String(parsed.data.page));
      search.set("pageSize", String(parsed.data.pageSize));
      return request(
        `/api/v1/admin/customers?${search.toString()}`,
        adminApplicationQueueResponseSchema,
      );
    },
    getCustomerDetail(customerId: string): Promise<AdminCustomerDetail> {
      return request(
        `/api/v1/admin/customers/${encodeURIComponent(customerId)}`,
        adminCustomerDetailSchema,
      );
    },
    getCancellation(contractId: string): Promise<AdminCancellation> {
      return request(
        `/api/v1/admin/contracts/${encodeURIComponent(contractId)}/cancellation`,
        adminCancellationSchema,
      );
    },
    scheduleCancellation(contractId: string): Promise<AdminCancellation> {
      return request(
        `/api/v1/admin/contracts/${encodeURIComponent(contractId)}/cancellation`,
        adminCancellationSchema,
        { method: "POST", body: "{}" },
      );
    },
    revokeCancellation(contractId: string): Promise<AdminCancellation> {
      return request(
        `/api/v1/admin/contracts/${encodeURIComponent(contractId)}/cancellation`,
        adminCancellationSchema,
        { method: "DELETE" },
      );
    },
    updateCancellationChecklist(
      contractId: string,
      value: UpdateCancellationChecklist,
    ): Promise<AdminCancellation> {
      const parsed = updateCancellationChecklistSchema.safeParse(value);
      if (!parsed.success) throw new AdminApiError("validation_error");
      return request(
        `/api/v1/admin/contracts/${encodeURIComponent(contractId)}/cancellation/checklist`,
        adminCancellationSchema,
        { method: "PUT", body: JSON.stringify(parsed.data) },
      );
    },
    declineApplication(
      applicationId: string,
      value: DeclineApplicationRequest = {},
    ): Promise<DeclineApplicationResponse> {
      const parsed = declineApplicationRequestSchema.safeParse(value);
      if (!parsed.success) throw new AdminApiError("validation_error");
      return request(
        `/api/v1/admin/applications/${encodeURIComponent(applicationId)}/decline`,
        declineApplicationResponseSchema,
        {
          method: "POST",
          body: JSON.stringify(parsed.data),
        },
      );
    },
    approveApplication(applicationId: string) {
      return request(
        `/api/v1/admin/applications/${encodeURIComponent(applicationId)}/approve`,
        approveApplicationResponseSchema,
        { method: "POST", body: "{}" },
      );
    },
    getRequestContracts(): Promise<EligibleRequestContracts> {
      return request(
        "/api/v1/admin/request-contracts",
        eligibleRequestContractsSchema,
      );
    },
    getAdminRequests(): Promise<{ items: AdminRequestSummary[] }> {
      return request("/api/v1/admin/requests", adminRequestListSchema);
    },
    getAdminRequest(requestId: string): Promise<AdminRequestDetail> {
      return request(
        `/api/v1/admin/requests/${encodeURIComponent(requestId)}`,
        adminRequestDetailSchema,
      );
    },
    createRequest(value: CreateRequest, idempotencyKey: string) {
      const parsed = createRequestSchema.safeParse(value);
      if (!parsed.success) throw new AdminApiError("validation_error");
      return request(`/api/v1/admin/requests`, createRequestResponseSchema, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(parsed.data),
      });
    },
    sendEstimate(
      requestId: string,
      value: CreateEstimate,
      idempotencyKey: string,
    ): Promise<RequestEstimate> {
      const parsed = createEstimateSchema.safeParse(value);
      if (!parsed.success) throw new AdminApiError("validation_error");
      return request(
        `/api/v1/admin/requests/${encodeURIComponent(requestId)}/estimates`,
        createEstimateResponseSchema,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(parsed.data),
        },
      );
    },
    completeRequest(
      requestId: string,
      value: CompleteRequest,
    ): Promise<CompleteRequestResponse> {
      const parsed = completeRequestSchema.safeParse(value);
      if (!parsed.success) throw new AdminApiError("validation_error");
      return request(
        `/api/v1/admin/requests/${encodeURIComponent(requestId)}/complete`,
        completeRequestResponseSchema,
        { method: "POST", body: JSON.stringify(parsed.data) },
      );
    },
    getPlanQuote(customerId: string): Promise<AdminPlanQuote> {
      return request(
        `/api/v1/admin/customers/${encodeURIComponent(customerId)}/plan-quote`,
        adminPlanQuoteSchema,
      );
    },
    sendPlanQuote(
      customerId: string,
      value: CreatePlanQuote,
    ): Promise<CreatePlanQuoteResponse> {
      return request(
        `/api/v1/admin/customers/${encodeURIComponent(customerId)}/plan-quote`,
        createPlanQuoteResponseSchema,
        { method: "POST", body: JSON.stringify(value) },
      );
    },
    getInvoices(): Promise<InvoiceList> {
      return request("/api/v1/admin/invoices", invoiceListSchema);
    },
    getPaymentReviews(): Promise<AdminPaymentReviewsResponse> {
      return request(
        "/api/v1/admin/payment-reviews",
        adminPaymentReviewsResponseSchema,
      );
    },
    resolvePaymentReview(
      eventId: string,
      value: { outcome: "handled_manually" | "not_applicable" },
    ) {
      const parsed = adminPaymentReviewResolveRequestSchema.safeParse(value);
      if (!parsed.success) throw new AdminApiError("validation_error");
      return request(
        `/api/v1/admin/payment-reviews/${encodeURIComponent(eventId)}/resolve`,
        adminPaymentReviewResolveResponseSchema,
        { method: "POST", body: JSON.stringify(parsed.data) },
      );
    },
    getNotificationFailures(): Promise<AdminNotificationFailuresResponse> {
      return request(
        "/api/v1/admin/notification-failures?limit=100",
        adminNotificationFailuresResponseSchema,
      );
    },
    retryNotificationFailure(notificationId: string) {
      return request(
        `/api/v1/admin/notification-failures/${encodeURIComponent(notificationId)}/retry`,
        adminNotificationFailureRetryResponseSchema,
        { method: "POST", body: JSON.stringify({}) },
      );
    },
    getPendingBankTransfers() {
      return request(
        "/api/v1/admin/bank-transfers/pending",
        pendingBankTransfersSchema,
      );
    },
    confirmBankPayment(invoiceId: string, value: ConfirmBankPaymentRequest) {
      const parsed = confirmBankPaymentRequestSchema.safeParse(value);
      if (!parsed.success) throw new AdminApiError("validation_error");
      return request(
        `/api/v1/admin/invoices/${encodeURIComponent(invoiceId)}/confirm-payment`,
        confirmBankPaymentResponseSchema,
        { method: "POST", body: JSON.stringify(parsed.data) },
      );
    },
    voidInvoice(invoiceId: string, value: { reason: string }) {
      const parsed = voidInvoiceRequestSchema.safeParse(value);
      if (!parsed.success) throw new AdminApiError("validation_error");
      return request(
        `/api/v1/admin/invoices/${encodeURIComponent(invoiceId)}/void`,
        adminInvoiceDetailSchema,
        { method: "POST", body: JSON.stringify(parsed.data) },
      );
    },
    getInvoiceReadiness(): Promise<InvoiceReadiness> {
      return request(
        "/api/v1/admin/invoices/readiness",
        invoiceReadinessSchema,
      );
    },
    getInvoice(invoiceId: string): Promise<AdminInvoiceDetail> {
      return request(
        `/api/v1/admin/invoices/${encodeURIComponent(invoiceId)}`,
        adminInvoiceDetailSchema,
      );
    },
    getInvoicePdf(invoiceId: string): Promise<Blob> {
      return requestBlob(
        `/api/v1/admin/invoices/${encodeURIComponent(invoiceId)}/pdf`,
      );
    },
  };
}

export type AdminApiClient = ReturnType<typeof createAdminApiClient>;
