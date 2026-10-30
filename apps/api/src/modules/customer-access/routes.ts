import {
  customerAccessSchema,
  welcomeSeenResponseSchema,
} from "@kobito/shared";
import { Hono } from "hono";
import { customerScopeFor } from "../../platform/scope.js";
import { ApiError, type ApiVariables } from "../../platform/types.js";
import type { CustomerAccessModule } from "./contracts.js";

export function createCustomerAccessRoutes(access: CustomerAccessModule) {
  const routes = new Hono<{ Variables: ApiVariables }>();
  routes.get("/me/access", async (context) => {
    const response = await access.getAccess(
      customerScopeFor(context.get("principal")),
    );
    return context.json(customerAccessSchema.parse(response));
  });
  routes.post("/me/welcome-seen", async (context) => {
    if (
      context.req
        .header("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      throw new ApiError(400, "invalid_request");
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      throw new ApiError(400, "invalid_request");
    }
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 0
    )
      throw new ApiError(422, "validation_error");
    const response = await access.markWelcomeSeen(
      customerScopeFor(context.get("principal")),
    );
    const validated = welcomeSeenResponseSchema.parse(response);
    return context.json(validated);
  });
  return routes;
}
