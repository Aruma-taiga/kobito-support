import { approvePlanQuoteRequestSchema } from "@kobito/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { customerScopeFor } from "../../platform/scope.js";
import { ApiError, type ApiVariables } from "../../platform/types.js";
import type { PlanQuoteModule } from "./contracts.js";

async function jsonBody(context: {
  req: { header(name: string): string | undefined; json(): Promise<unknown> };
}) {
  if (
    context.req
      .header("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== "application/json"
  )
    throw new ApiError(400, "invalid_request");
  try {
    return await context.req.json();
  } catch {
    throw new ApiError(400, "invalid_request");
  }
}

const limit = (maxSize: number) =>
  bodyLimit({
    maxSize,
    onError: (context) =>
      context.json({ error: { code: "invalid_request" } }, 400),
  });

export function createPlanQuoteAdminRoutes(
  routes: Hono<{ Variables: ApiVariables }>,
  planQuotes: PlanQuoteModule,
) {
  routes.get("/customers/:id/plan-quote", async (context) =>
    context.json(
      await planQuotes.getAdmin(
        context.get("principal"),
        context.req.param("id"),
      ),
    ),
  );
  routes.post("/customers/:id/plan-quote", limit(16 * 1024), async (context) =>
    context.json(
      await planQuotes.createAdmin(
        context.get("principal"),
        context.req.param("id"),
        await jsonBody(context),
      ),
      201,
    ),
  );
  return routes;
}

export function createPlanQuoteCustomerRoutes(planQuotes: PlanQuoteModule) {
  const routes = new Hono<{ Variables: ApiVariables }>();
  routes.get("/me/plan-quote", async (context) =>
    context.json(
      await planQuotes.getCustomer(customerScopeFor(context.get("principal"))),
    ),
  );
  routes.post("/me/plan-quote/:id/approve", limit(4096), async (context) => {
    const body = await jsonBody(context);
    if (!approvePlanQuoteRequestSchema.safeParse(body).success)
      throw new ApiError(422, "validation_error");
    return context.json(
      await planQuotes.approveCustomer(
        customerScopeFor(context.get("principal")),
        context.get("principal"),
        context.req.param("id"),
      ),
    );
  });
  return routes;
}
