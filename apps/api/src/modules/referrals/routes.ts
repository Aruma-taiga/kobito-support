import type { Hono } from "hono";
import { ApiError, type ApiVariables } from "../../platform/types.js";
import type { ReferralModule } from "./contracts.js";

export function createReferralAdminRoutes(
  routes: Hono<{ Variables: ApiVariables }>,
  referrals: ReferralModule,
) {
  routes.get("/referrals", async (context) => {
    const params = [...new URL(context.req.url).searchParams.entries()];
    if (new Set(params.map(([key]) => key)).size !== params.length)
      throw new ApiError(400, "invalid_request");
    return context.json(
      await referrals.getAdmin(
        context.get("principal"),
        Object.fromEntries(params),
      ),
    );
  });
  return routes;
}
