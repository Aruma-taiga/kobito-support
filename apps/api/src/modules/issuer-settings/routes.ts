import { updateAdminIssuerSettingsRequestSchema } from "@kobito/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  createAuthenticate,
  type IdentityVerifier,
  requireAdmin,
} from "../../platform/auth.js";
import { ApiError, type ApiVariables } from "../../platform/types.js";
import type { AccountsDataRepository } from "../accounts/repository.js";
import type { IssuerSettingsModule } from "./contracts.js";

export function createAdminIssuerSettingsRoutes(dependencies: {
  verifier: IdentityVerifier;
  accounts: AccountsDataRepository;
  issuerSettings: IssuerSettingsModule;
}) {
  const routes = new Hono<{ Variables: ApiVariables }>();
  const authenticate = createAuthenticate(
    dependencies.verifier,
    dependencies.accounts,
    true,
  );
  routes.use("*", authenticate, requireAdmin());

  routes.get("/", async (context) =>
    context.json(
      await dependencies.issuerSettings.get(context.get("principal")),
    ),
  );
  routes.put(
    "/",
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (context) =>
        context.json({ error: { code: "invalid_request" } }, 400),
    }),
    async (context) => {
      const contentType = context.req
        .header("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json")
        throw new ApiError(400, "invalid_request");
      let raw: unknown;
      try {
        raw = await context.req.json();
      } catch {
        throw new ApiError(400, "invalid_request");
      }
      const request = updateAdminIssuerSettingsRequestSchema.safeParse(raw);
      if (!request.success) throw new ApiError(422, "validation_error");
      return context.json(
        await dependencies.issuerSettings.update(
          context.get("principal"),
          request.data,
        ),
      );
    },
  );
  routes.all("*", (context) =>
    context.json({ error: { code: "not_found" } }, 404),
  );
  return routes;
}
