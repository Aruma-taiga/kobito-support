import { Hono } from "hono";
import type { ApiVariables } from "../../platform/types.js";
import type { PaymentLinkModule } from "./contracts.js";

export function createPaymentLinkRoutes(paymentLinks: PaymentLinkModule) {
  const routes = new Hono<{ Variables: ApiVariables }>();
  routes.post("/me/invoices/:id/payment-link", async (context) =>
    context.json(
      await paymentLinks.create(
        context.get("principal"),
        context.req.param("id"),
      ),
    ),
  );
  return routes;
}
