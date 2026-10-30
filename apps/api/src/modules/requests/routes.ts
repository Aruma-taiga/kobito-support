import {
  approveEstimateSchema,
  type CompleteRequest,
  type CreateEstimate,
  type CreateRequest,
} from "@kobito/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { customerScopeFor } from "../../platform/scope.js";
import { ApiError, type ApiVariables } from "../../platform/types.js";
import type { RequestModule } from "./contracts.js";

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
export function createRequestAdminRoutes(
  routes: Hono<{ Variables: ApiVariables }>,
  requests: RequestModule,
) {
  routes.get("/request-contracts", async (c) =>
    c.json(await requests.eligibleContracts()),
  );
  routes.get("/requests", async (c) => c.json(await requests.listAdmin()));
  routes.post(
    "/requests",
    bodyLimit({
      maxSize: 8192,
      onError: (c) => c.json({ error: { code: "invalid_request" } }, 400),
    }),
    async (c) => {
      const key = c.req.header("idempotency-key");
      if (!key) throw new ApiError(400, "invalid_request");
      const body = await jsonBody(c);
      const result = await requests.createAdmin(
        c.get("principal"),
        key,
        body as CreateRequest,
      );
      return c.json(result, result.replayed ? 200 : 201);
    },
  );
  routes.get("/requests/:id", async (c) =>
    c.json(await requests.getAdmin(c.req.param("id"))),
  );
  routes.post(
    "/requests/:id/complete",
    bodyLimit({
      maxSize: 4096,
      onError: (c) => c.json({ error: { code: "invalid_request" } }, 400),
    }),
    async (c) => {
      const body = await jsonBody(c);
      return c.json(
        await requests.completeRequest(
          c.get("principal"),
          c.req.param("id"),
          body as CompleteRequest,
        ),
      );
    },
  );
  routes.post(
    "/requests/:id/estimates",
    bodyLimit({
      maxSize: 16384,
      onError: (c) => c.json({ error: { code: "invalid_request" } }, 400),
    }),
    async (c) => {
      const key = c.req.header("idempotency-key");
      if (!key) throw new ApiError(400, "invalid_request");
      const body = await jsonBody(c);
      const result = await requests.createEstimate(
        c.get("principal"),
        key,
        c.req.param("id"),
        body as CreateEstimate,
      );
      return c.json(result, result.replayed ? 200 : 201);
    },
  );
  return routes;
}
export function createRequestCustomerRoutes(requests: RequestModule) {
  const routes = new Hono<{ Variables: ApiVariables }>();
  routes.get("/me/requests", async (c) => {
    const params = [...new URL(c.req.url).searchParams.entries()];
    if (
      params.some(([key]) => key !== "open") ||
      new Set(params.map(([key]) => key)).size !== params.length ||
      params.some(([, value]) => value !== "1")
    )
      throw new ApiError(422, "validation_error");
    return c.json(
      await requests.listCustomer(
        customerScopeFor(c.get("principal")),
        params.length > 0,
      ),
    );
  });
  routes.get("/me/requests/:id", async (c) =>
    c.json(
      await requests.getCustomer(
        customerScopeFor(c.get("principal")),
        c.req.param("id"),
      ),
    ),
  );
  routes.post(
    "/me/estimates/:id/approve",
    bodyLimit({
      maxSize: 4096,
      onError: (c) => c.json({ error: { code: "invalid_request" } }, 400),
    }),
    async (c) => {
      const body = await jsonBody(c);
      if (!approveEstimateSchema.safeParse(body).success)
        throw new ApiError(422, "validation_error");
      return c.json(
        await requests.approveEstimate(
          customerScopeFor(c.get("principal")),
          c.get("principal"),
          c.req.param("id"),
        ),
      );
    },
  );
  return routes;
}
