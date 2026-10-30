import {
  adminApplicationQueueQuerySchema,
  declineApplicationRequestSchema,
} from "@kobito/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  createAuthenticate,
  type IdentityVerifier,
  requireAdmin,
} from "../../platform/auth.js";
import { ApiError, type ApiVariables } from "../../platform/types.js";
import type { AccountsDataRepository } from "../accounts/repository.js";
import type { AdminModule } from "./contracts.js";

const maxDeclineBodyBytes = 16 * 1024;

export function createAdminRoutes(dependencies: {
  admin: AdminModule;
  verifier: IdentityVerifier;
  accounts: AccountsDataRepository;
}) {
  const routes = new Hono<{ Variables: ApiVariables }>();
  const authenticate = createAuthenticate(
    dependencies.verifier,
    dependencies.accounts,
    true,
  );
  routes.use("*", authenticate, requireAdmin());

  routes.get("/session", (context) => context.json({ role: "admin" as const }));

  routes.get("/customers", async (context) => {
    const params = [...new URL(context.req.url).searchParams.entries()];
    if (new Set(params.map(([key]) => key)).size !== params.length) {
      throw new ApiError(422, "validation_error");
    }
    const query = adminApplicationQueueQuerySchema.safeParse(
      Object.fromEntries(params),
    );
    if (!query.success) throw new ApiError(422, "validation_error");
    return context.json(await dependencies.admin.listApplications(query.data));
  });

  routes.get("/customers/:id", async (context) => {
    const detail = await dependencies.admin.getCustomerDetail(
      context.req.param("id"),
    );
    return context.json(detail);
  });

  routes.post(
    "/applications/:id/decline",
    bodyLimit({
      maxSize: maxDeclineBodyBytes,
      onError: (context) =>
        context.json({ error: { code: "invalid_request" } }, 400),
    }),
    async (context) => {
      const contentType = context.req
        .header("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json") {
        throw new ApiError(400, "invalid_request");
      }
      let rawBody: unknown;
      try {
        rawBody = await context.req.json();
      } catch {
        throw new ApiError(400, "invalid_request");
      }
      const body = declineApplicationRequestSchema.safeParse(rawBody);
      if (!body.success) throw new ApiError(422, "validation_error");
      return context.json(
        await dependencies.admin.declineApplication(
          context.get("principal"),
          context.req.param("id"),
          body.data,
        ),
      );
    },
  );

  routes.all("*", (context) =>
    context.json({ error: { code: "not_found" } }, 404),
  );
  return routes;
}
