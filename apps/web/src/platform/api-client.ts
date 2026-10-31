import {
  type ApplicationReceipt,
  type ApproveEstimateResponse,
  type ApprovePlanQuoteResponse,
  applicationReceiptSchema,
  approveEstimateResponseSchema,
  approvePlanQuoteResponseSchema,
  type CustomerAccess,
  type CustomerContractResponse,
  type CustomerPlanQuote,
  type CustomerRequestDetail,
  type CustomerRequestSummary,
  customerAccessSchema,
  customerContractResponseSchema,
  customerPlanQuoteSchema,
  customerRequestDetailSchema,
  customerRequestListSchema,
  type InvoiceDetail,
  type InvoiceList,
  invoiceDetailSchema,
  invoiceListSchema,
  lineLinkResponseSchema,
  lineLinkStatusResponseSchema,
  lineSignInResponseSchema,
  lineTokenRequestSchema,
  type MeResponse,
  meResponseSchema,
  type PublicConfig,
  type PublicPartner,
  type PublicPlans,
  publicConfigSchema,
  publicPartnerSchema,
  publicPlansSchema,
  type WelcomeSeenResponse,
  welcomeSeenResponseSchema,
} from "@kobito/shared";

type LineLinkResponse = ReturnType<typeof lineLinkResponseSchema.parse>;
type LineLinkStatusResponse = ReturnType<
  typeof lineLinkStatusResponseSchema.parse
>;
type LineSignInResponse = ReturnType<typeof lineSignInResponseSchema.parse>;

export interface ApiAuthUser {
  uid?: string;
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
      | "plan_quote_conflict"
      | "plan_quote_expired"
      | "insufficient_credits"
      | "validation_error"
      | "conflict"
      | "service_unavailable"
      | "invalid_line_token"
      | "session_changed",
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
    expectedAuthUserId?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (authenticated) {
      const user = options.getCurrentUser();
      if (!user) throw new ApiClientError("unauthorized");
      if (expectedAuthUserId !== undefined && user.uid !== expectedAuthUserId)
        throw new ApiClientError("session_changed");
      let token: string;
      try {
        token = await user.getIdToken();
      } catch {
        if (
          expectedAuthUserId !== undefined &&
          options.getCurrentUser()?.uid !== expectedAuthUserId
        )
          throw new ApiClientError("session_changed");
        await options.signOut().catch(() => undefined);
        throw new ApiClientError("unauthorized");
      }
      if (
        expectedAuthUserId !== undefined &&
        options.getCurrentUser()?.uid !== expectedAuthUserId
      )
        throw new ApiClientError("session_changed");
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

    if (
      expectedAuthUserId !== undefined &&
      options.getCurrentUser()?.uid !== expectedAuthUserId
    )
      throw new ApiClientError("session_changed");

    if (response.status === 401) {
      if (authenticated) await options.signOut().catch(() => undefined);
      throw new ApiClientError("unauthorized");
    }
    if (!response.ok) {
      if (response.status === 403) throw new ApiClientError("forbidden");
      if (response.status === 404) throw new ApiClientError("not_found");
      if (response.status === 409) throw new ApiClientError("conflict");
      if (response.status === 503)
        throw new ApiClientError("service_unavailable");
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
    expectedAuthUserId?: string,
  ): Promise<T> {
    const user = options.getCurrentUser();
    if (!user) throw new ApiClientError("unauthorized");
    if (expectedAuthUserId !== undefined && user.uid !== expectedAuthUserId)
      throw new ApiClientError("session_changed");
    let token: string;
    try {
      token = await user.getIdToken();
    } catch {
      if (
        expectedAuthUserId !== undefined &&
        options.getCurrentUser()?.uid !== expectedAuthUserId
      )
        throw new ApiClientError("session_changed");
      await options.signOut().catch(() => undefined);
      throw new ApiClientError("unauthorized");
    }
    if (
      expectedAuthUserId !== undefined &&
      options.getCurrentUser()?.uid !== expectedAuthUserId
    )
      throw new ApiClientError("session_changed");
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
    if (
      expectedAuthUserId !== undefined &&
      options.getCurrentUser()?.uid !== expectedAuthUserId
    )
      throw new ApiClientError("session_changed");
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
        responseCode === "conflict" ||
        responseCode === "request_conflict" ||
        responseCode === "estimate_conflict" ||
        responseCode === "plan_quote_conflict" ||
        responseCode === "plan_quote_expired" ||
        responseCode === "insufficient_credits" ||
        responseCode === "invalid_line_token"
      ) {
        throw new ApiClientError(responseCode);
      }
      if (response.status === 403) throw new ApiClientError("forbidden");
      if (response.status === 404) throw new ApiClientError("not_found");
      if (response.status === 409) throw new ApiClientError("conflict");
      if (response.status === 503)
        throw new ApiClientError("service_unavailable");
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

  async function postPublicLineToken<T>(
    endpoint: string,
    schema: {
      safeParse(data: unknown): { success: true; data: T } | { success: false };
    },
    idToken: string,
  ): Promise<T> {
    const body = lineTokenRequestSchema.safeParse({ idToken });
    if (!body.success) throw new ApiClientError("invalid_response");
    let response: Response;
    try {
      response = await fetcher(new URL(endpoint, options.baseUrl), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body.data),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new ApiClientError("network");
    }
    if (response.status === 401) throw new ApiClientError("unauthorized");
    if (response.status === 404) throw new ApiClientError("not_found");
    if (response.status === 409) throw new ApiClientError("conflict");
    if (response.status === 503)
      throw new ApiClientError("service_unavailable");
    if (!response.ok) throw new ApiClientError("server");
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
    signInWithLine: (idToken: string): Promise<LineSignInResponse> =>
      postPublicLineToken(
        "/api/v1/auth/line",
        lineSignInResponseSchema,
        idToken,
      ),
    getLineLinkStatus: (
      expectedAuthUserId?: string,
    ): Promise<LineLinkStatusResponse> =>
      getJson(
        "/api/v1/me/line",
        lineLinkStatusResponseSchema,
        true,
        expectedAuthUserId,
      ),
    linkLine: (
      idToken: string,
      expectedAuthUserId: string,
    ): Promise<LineLinkResponse> =>
      postJson(
        "/api/v1/me/line/link",
        lineLinkResponseSchema,
        { idToken },
        expectedAuthUserId,
      ),
    postApplication,
    getMe: (): Promise<MeResponse> =>
      getJson("/api/v1/me", meResponseSchema, true),
    getContract: (): Promise<CustomerContractResponse> =>
      getJson("/api/v1/me/contract", customerContractResponseSchema, true),
    getCustomerAccess: (): Promise<CustomerAccess> =>
      getJson("/api/v1/me/access", customerAccessSchema, true),
    markWelcomeSeen: (): Promise<WelcomeSeenResponse> =>
      postJson("/api/v1/me/welcome-seen", welcomeSeenResponseSchema, {}),
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
    getPlanQuote(): Promise<CustomerPlanQuote> {
      return getJson("/api/v1/me/plan-quote", customerPlanQuoteSchema, true);
    },
    approvePlanQuote(quoteId: string): Promise<ApprovePlanQuoteResponse> {
      return postJson(
        `/api/v1/me/plan-quote/${encodeURIComponent(quoteId)}/approve`,
        approvePlanQuoteResponseSchema,
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
