import { Hono } from "hono";
import type { ApiVariables } from "../../platform/types.js";
import type { AccountsService } from "./service.js";

export function createAccountsRoutes(service: AccountsService) {
  const routes = new Hono<{ Variables: ApiVariables }>();
  routes.get("/me", async (context) =>
    context.json(await service.getMe(context.get("principal"))),
  );
  return routes;
}
