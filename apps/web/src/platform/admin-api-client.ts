import {
  type AdminApplicationQueueQuery,
  type AdminApplicationQueueResponse,
  type AdminCustomerDetail,
  type AdminSession,
  adminApplicationQueueQuerySchema,
  adminApplicationQueueResponseSchema,
  adminCustomerDetailSchema,
  adminSessionSchema,
  type DeclineApplicationRequest,
  type DeclineApplicationResponse,
  declineApplicationRequestSchema,
  declineApplicationResponseSchema,
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
      const codes: Record<number, AdminApiErrorCode> = {
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        422: "validation_error",
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
  };
}

export type AdminApiClient = ReturnType<typeof createAdminApiClient>;
