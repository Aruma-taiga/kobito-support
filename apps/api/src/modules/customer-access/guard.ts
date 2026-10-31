import type { MiddlewareHandler } from "hono";
import { customerScopeFor } from "../../platform/scope.js";
import { ApiError, type ApiVariables } from "../../platform/types.js";
import type { CustomerAccessModule } from "./contracts.js";

export function requireCustomerAccess(
  access: CustomerAccessModule,
): MiddlewareHandler<{ Variables: ApiVariables }> {
  return async (context, next) => {
    const path = context.req.path;
    const method = context.req.method.toUpperCase();
    if (path === "/api/v1/me/access" && method === "GET") {
      await next();
      return;
    }
    if (path === "/api/v1/me/welcome-seen" && method === "POST") {
      await next();
      return;
    }
    if (path === "/api/v1/me/line" || path === "/api/v1/me/line/link") {
      await next();
      return;
    }

    const state = await access.getAccess(
      customerScopeFor(context.get("principal")),
    );
    if (
      state.access === "pending" &&
      ((method === "GET" && path === "/api/v1/me/plan-quote") ||
        (method === "POST" &&
          /^\/api\/v1\/me\/plan-quote\/[^/]+\/approve$/.test(path)))
    ) {
      await next();
      return;
    }
    if (
      method === "GET" &&
      path === "/api/v1/me" &&
      (state.access === "active" || state.access === "none")
    ) {
      await next();
      return;
    }
    if (
      method === "GET" &&
      path.startsWith("/api/v1/me/invoices") &&
      state.invoiceAccess
    ) {
      await next();
      return;
    }
    if (state.access === "active") {
      await next();
      return;
    }
    throw new ApiError(404, "not_found");
  };
}
