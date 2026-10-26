import {
  type AdminApplicationQueueQuery,
  type AdminApplicationQueueResponse,
  type AdminCustomerDetail,
  type AdminRequestDetail,
  type AdminRequestSummary,
  type AdminSession,
  adminApplicationQueueQuerySchema,
  adminApplicationQueueResponseSchema,
  adminCustomerDetailSchema,
  adminRequestDetailSchema,
  adminRequestListSchema,
  adminSessionSchema,
  approveApplicationResponseSchema,
  type CompleteRequest,
  type CompleteRequestResponse,
  type ConfirmBankPaymentRequest,
  type CreateEstimate,
  type CreateRequest,
  completeRequestResponseSchema,
  completeRequestSchema,
  confirmBankPaymentRequestSchema,
  confirmBankPaymentResponseSchema,
  createEstimateResponseSchema,
  createEstimateSchema,
  createRequestResponseSchema,
  createRequestSchema,
  type DeclineApplicationRequest,
  type DeclineApplicationResponse,
  declineApplicationRequestSchema,
  declineApplicationResponseSchema,
  type EligibleRequestContracts,
  eligibleRequestContractsSchema,
  type InvoiceDetail,
  type InvoiceList,
  type InvoiceReadiness,
  invoiceDetailSchema,
  invoiceListSchema,
  invoiceReadinessSchema,
  pendingBankTransfersSchema,
  type RequestEstimate,
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
  | "invalid_response";

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
      if (
        responseCode === "request_conflict" ||
        responseCode === "estimate_conflict" ||
        responseCode === "insufficient_credits"
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
    getInvoices(): Promise<InvoiceList> {
      return request("/api/v1/admin/invoices", invoiceListSchema);
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
    getInvoiceReadiness(): Promise<InvoiceReadiness> {
      return request(
        "/api/v1/admin/invoices/readiness",
        invoiceReadinessSchema,
      );
    },
    getInvoice(invoiceId: string): Promise<InvoiceDetail> {
      return request(
        `/api/v1/admin/invoices/${encodeURIComponent(invoiceId)}`,
        invoiceDetailSchema,
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
