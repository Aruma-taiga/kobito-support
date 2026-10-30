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
    readonly status: 401 | 403 | 404 | 500,
    readonly code:
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "internal_error",
  ) {
    super(code);
  }
}
