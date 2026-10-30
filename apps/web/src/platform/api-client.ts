import {
  type ApplicationReceipt,
  type ApproveEstimateResponse,
  applicationReceiptSchema,
  approveEstimateResponseSchema,
  type CustomerContractResponse,
  type CustomerRequestDetail,
  type CustomerRequestSummary,
  customerContractResponseSchema,
  customerRequestDetailSchema,
  customerRequestListSchema,
  type InvoiceDetail,
  type InvoiceList,
  invoiceDetailSchema,
  invoiceListSchema,
  type MeResponse,
  meResponseSchema,
  type PublicConfig,
  type PublicPartner,
  type PublicPlans,
  publicConfigSchema,
  publicPartnerSchema,
  publicPlansSchema,
} from "@kobito/shared";

export interface ApiAuthUser {
  getIdToken(): Promise<string>;
}

export interface ApiClientOptions {
  baseUrl: string;
  getCurrentUser(): ApiAuthUser | null;
  signOut(): Promise<void>;
  fetcher?: typeof fetch;
}

export class ApiClientError extends Error {
  constructor(
    readonly code:
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "network"
      | "server"
      | "invalid_response"
      | "conditions_changed"
      | "application_conflict"
      | "request_conflict"
      | "estimate_conflict"
      | "insufficient_credits"
      | "validation_error",
  ) {
    super(code);
  }
}

export function createApiClient(options: ApiClientOptions) {
  const fetcher = options.fetcher ?? fetch;

  async function getJson<T>(
    endpoint: string,
    schema: {
      safeParse(data: unknown): { success: true; data: T } | { success: false };
    },
    authenticated: boolean,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (authenticated) {
      const user = options.getCurrentUser();
      if (!user) throw new ApiClientError("unauthorized");
      let token: string;
      try {
        token = await user.getIdToken();
      } catch {
        await options.signOut().catch(() => undefined);
        throw new ApiClientError("unauthorized");
      }
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetcher(new URL(endpoint, options.baseUrl), {
        method: "GET",
        headers,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new ApiClientError("network");
    }

    if (response.status === 401) {
      if (authenticated) await options.signOut().catch(() => undefined);
      throw new ApiClientError("unauthorized");
    }
    if (!response.ok) {
      if (response.status === 403) throw new ApiClientError("forbidden");
      if (response.status === 404) throw new ApiClientError("not_found");
      throw new ApiClientError("server");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiClientError("invalid_response");
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new ApiClientError("invalid_response");
    return parsed.data;
  }

  async function postJson<T>(
    endpoint: string,
    schema: {
      safeParse(data: unknown): { success: true; data: T } | { success: false };
    },
    body: unknown,
  ): Promise<T> {
    const user = options.getCurrentUser();
    if (!user) throw new ApiClientError("unauthorized");
    let token: string;
    try {
      token = await user.getIdToken();
    } catch {
      await options.signOut().catch(() => undefined);
      throw new ApiClientError("unauthorized");
    }
    let response: Response;
    try {
      response = await fetcher(new URL(endpoint, options.baseUrl), {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new ApiClientError("network");
    }
    if (response.status === 401) {
      await options.signOut().catch(() => undefined);
      throw new ApiClientError("unauthorized");
    }
    if (!response.ok) {
      let responseCode: string | undefined;
      try {
        const payload = (await response.clone().json()) as {
          error?: { code?: unknown };
        };
        if (typeof payload.error?.code === "string")
          responseCode = payload.error.code;
      } catch {
        responseCode = undefined;
      }
      if (
        responseCode === "request_conflict" ||
        responseCode === "estimate_conflict" ||
        responseCode === "insufficient_credits"
      ) {
        throw new ApiClientError(responseCode);
      }
      if (response.status === 403) throw new ApiClientError("forbidden");
      if (response.status === 404) throw new ApiClientError("not_found");
      if (response.status === 422) throw new ApiClientError("validation_error");
      throw new ApiClientError("server");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiClientError("invalid_response");
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new ApiClientError("invalid_response");
    return parsed.data;
  }

  async function postApplication(
    payload: unknown,
    idempotencyKey: string,
  ): Promise<ApplicationReceipt> {
    const user = options.getCurrentUser();
    if (!user) throw new ApiClientError("unauthorized");
    let token: string;
    try {
      token = await user.getIdToken();
    } catch {
      throw new ApiClientError("unauthorized");
    }
    let response: Response;
    try {
      response = await fetcher(
        new URL("/api/v1/applications", options.baseUrl),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(payload),
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
        },
      );
    } catch {
      throw new ApiClientError("network");
    }
    if (response.status === 409) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      const code = (body as { error?: { code?: unknown } } | undefined)?.error
        ?.code;
      throw new ApiClientError(
        code === "offer_changed"
          ? "conditions_changed"
          : "application_conflict",
      );
    }
    if (!response.ok) {
      if (response.status === 401) throw new ApiClientError("unauthorized");
      if (response.status === 403) throw new ApiClientError("forbidden");
      throw new ApiClientError("server");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiClientError("invalid_response");
    }
    const parsed = applicationReceiptSchema.safeParse(body);
    if (!parsed.success) throw new ApiClientError("invalid_response");
    return parsed.data;
  }

  async function getInvoicePdf(invoiceId: string): Promise<Blob> {
    const user = options.getCurrentUser();
    if (!user) throw new ApiClientError("unauthorized");
    let token: string;
    try {
      token = await user.getIdToken();
    } catch {
      await options.signOut().catch(() => undefined);
      throw new ApiClientError("unauthorized");
    }
    let response: Response;
    try {
      response = await fetcher(
        new URL(
          `/api/v1/me/invoices/${encodeURIComponent(invoiceId)}/pdf`,
          options.baseUrl,
        ),
        {
          headers: {
            Accept: "application/pdf",
            Authorization: `Bearer ${token}`,
          },
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
        },
      );
    } catch {
      throw new ApiClientError("network");
    }
    if (response.status === 401) {
      await options.signOut().catch(() => undefined);
      throw new ApiClientError("unauthorized");
    }
    if (!response.ok) {
      if (response.status === 403) throw new ApiClientError("forbidden");
      if (response.status === 404) throw new ApiClientError("not_found");
      throw new ApiClientError("server");
    }
    if (
      response.headers.get("content-type")?.split(";")[0]?.trim() !==
      "application/pdf"
    ) {
      throw new ApiClientError("invalid_response");
    }
    try {
      return await response.blob();
    } catch {
      throw new ApiClientError("invalid_response");
    }
  }

  return {
    getPublicConfig: (): Promise<PublicConfig> =>
      getJson("/api/v1/public/config", publicConfigSchema, false),
    getPublicPlans: (): Promise<PublicPlans> =>
      getJson("/api/v1/public/plans", publicPlansSchema, false),
    getPublicPartner: (code: string): Promise<PublicPartner> =>
      getJson(
        `/api/v1/public/partners/${encodeURIComponent(code)}`,
        publicPartnerSchema,
        false,
      ),
    postApplication,
    getMe: (): Promise<MeResponse> =>
      getJson("/api/v1/me", meResponseSchema, true),
    getContract: (): Promise<CustomerContractResponse> =>
      getJson("/api/v1/me/contract", customerContractResponseSchema, true),
    getCustomerRequests(
      openOnly = false,
    ): Promise<{ items: CustomerRequestSummary[] }> {
      return getJson(
        `/api/v1/me/requests${openOnly ? "?open=1" : ""}`,
        customerRequestListSchema,
        true,
      );
    },
    getCustomerRequest(requestId: string): Promise<CustomerRequestDetail> {
      return getJson(
        `/api/v1/me/requests/${encodeURIComponent(requestId)}`,
        customerRequestDetailSchema,
        true,
      );
    },
    approveEstimate(estimateId: string): Promise<ApproveEstimateResponse> {
      return postJson(
        `/api/v1/me/estimates/${encodeURIComponent(estimateId)}/approve`,
        approveEstimateResponseSchema,
        {},
      );
    },
    getInvoices: (): Promise<InvoiceList> =>
      getJson("/api/v1/me/invoices", invoiceListSchema, true),
    getInvoice: (invoiceId: string): Promise<InvoiceDetail> =>
      getJson(
        `/api/v1/me/invoices/${encodeURIComponent(invoiceId)}`,
        invoiceDetailSchema,
        true,
      ),
    getInvoicePdf,
  };
}

export type ReturnTypeApiClient = ReturnType<typeof createApiClient>;
