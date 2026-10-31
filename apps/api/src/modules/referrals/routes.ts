import { payReferralRewardsRequestSchema } from "@kobito/shared";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ApiError, type ApiVariables } from "../../platform/types.js";
import type { ReferralModule } from "./contracts.js";

export function createReferralAdminRoutes(
  routes: Hono<{ Variables: ApiVariables }>,
  referrals: ReferralModule,
) {
  routes.get("/referrals", async (context) => {
    const params = [...new URL(context.req.url).searchParams.entries()];
    if (new Set(params.map(([key]) => key)).size !== params.length)
      throw new ApiError(422, "validation_error");
    return context.json(
      await referrals.getAdmin(
        context.get("principal"),
        Object.fromEntries(params),
      ),
    );
  });
  routes.post(
    "/referrals/payments",
    bodyLimit({ maxSize: 4096 }),
    async (context) => {
      const contentType = context.req
        .header("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json")
        throw new ApiError(400, "invalid_request");
      let body: unknown;
      try {
        body = await context.req.json();
      } catch {
        throw new ApiError(400, "invalid_request");
      }
      const parsed = payReferralRewardsRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiError(422, "validation_error");
      return context.json(
        await referrals.payAdmin(context.get("principal"), parsed.data),
      );
    },
  );
  return routes;
}
