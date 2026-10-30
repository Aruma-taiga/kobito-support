import type { MiddlewareHandler } from "hono";

export interface Principal {
  authUserId: string;
  role: "customer" | "admin";
  customerId: string | null;
  secondFactor: string | null;
}

export interface ApiVariables {
  principal: Principal;
  requestId: string;
}

export type ApiMiddleware = MiddlewareHandler<{ Variables: ApiVariables }>;

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503,
    readonly code:
      | "invalid_request"
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "application_conflict"
      | "offer_changed"
      | "validation_error"
      | "internal_error"
      | "application_unavailable"
      | "invoice_unavailable"
      | "request_conflict"
      | "estimate_conflict"
      | "insufficient_credits"
      | "settings_revision_conflict"
      | "conflict"
      | "service_unavailable"
      | "invalid_line_token",
  ) {
    super(code);
  }
}
