import { lineTokenRequestSchema } from "@kobito/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { customerScopeFor } from "../../../platform/scope.js";
import { ApiError, type ApiVariables } from "../../../platform/types.js";
import type { LineModule } from "./contracts.js";

export function createLinePublicRoutes(line: LineModule) {
  const routes = new Hono<{ Variables: ApiVariables }>();
  routes.post(
    "/auth/line",
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) => c.json({ error: { code: "invalid_request" } }, 413),
    }),
    async (c) => {
      const parsed = lineTokenRequestSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) throw new ApiError(400, "invalid_request");
      return c.json(await line.signIn(parsed.data.idToken));
    },
  );
  return routes;
}
export function createLineCustomerRoutes(line: LineModule) {
  const routes = new Hono<{ Variables: ApiVariables }>();
  routes.post(
    "/me/line/link",
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) => c.json({ error: { code: "invalid_request" } }, 413),
    }),
    async (c) => {
      const parsed = lineTokenRequestSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) throw new ApiError(400, "invalid_request");
      return c.json(
        await line.link(
          customerScopeFor(c.get("principal")),
          parsed.data.idToken,
        ),
      );
    },
  );
  routes.get("/me/line", async (c) =>
    c.json(await line.status(customerScopeFor(c.get("principal")))),
  );
  return routes;
}
