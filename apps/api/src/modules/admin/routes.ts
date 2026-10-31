import {
  adminApplicationQueueQuerySchema,
  approveApplicationRequestSchema,
  confirmBankPaymentRequestSchema,
  declineApplicationRequestSchema,
  updateCancellationChecklistSchema,
  voidInvoiceRequestSchema,
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
import type { InvoiceModule } from "../invoices/contracts.js";
import type { PlanQuoteModule } from "../plan-quotes/contracts.js";
import { createPlanQuoteAdminRoutes } from "../plan-quotes/routes.js";
import type { ReferralModule } from "../referrals/contracts.js";
import { createReferralAdminRoutes } from "../referrals/routes.js";
import type { RequestModule } from "../requests/contracts.js";
import { createRequestAdminRoutes } from "../requests/routes.js";
import type { AdminModule } from "./contracts.js";
import type { RetentionModule } from "./retention-contracts.js";

const maxDeclineBodyBytes = 16 * 1024;
const maxApproveBodyBytes = 4 * 1024;
const maxVoidInvoiceBodyBytes = 4 * 1024;

export function createAdminRoutes(dependencies: {
  admin: AdminModule;
  verifier: IdentityVerifier;
  accounts: AccountsDataRepository;
  invoices: InvoiceModule;
  requests?: RequestModule;
  planQuotes?: PlanQuoteModule;
  referrals?: ReferralModule;
  retention?: RetentionModule;
}) {
  const routes = new Hono<{ Variables: ApiVariables }>();
  const authenticate = createAuthenticate(
    dependencies.verifier,
    dependencies.accounts,
    true,
  );
  routes.use("*", authenticate, requireAdmin());

  routes.get("/session", (context) => context.json({ role: "admin" as const }));
  if (dependencies.retention) {
    routes.get("/retention", async (context) =>
      context.json(await dependencies.retention?.listRetention()),
    );
  }
  routes.get("/payment-reviews", async (context) => {
    const params = [...new URL(context.req.url).searchParams.entries()];
    if (new Set(params.map(([key]) => key)).size !== params.length)
      throw new ApiError(422, "validation_error");
    return context.json(
      await dependencies.admin.listPaymentReviews(Object.fromEntries(params)),
    );
  });
  routes.get("/notification-failures", async (context) => {
    const params = [...new URL(context.req.url).searchParams.entries()];
    if (new Set(params.map(([key]) => key)).size !== params.length)
      throw new ApiError(422, "validation_error");
    return context.json(
      await dependencies.admin.listNotificationFailures(
        Object.fromEntries(params),
      ),
    );
  });
  routes.post("/notification-failures/:id/retry", async (context) =>
    context.json(
      await dependencies.admin.retryNotificationFailure(
        context.get("principal"),
        context.req.param("id"),
      ),
    ),
  );
  if (dependencies.requests)
    createRequestAdminRoutes(routes, dependencies.requests);
  if (dependencies.planQuotes)
    createPlanQuoteAdminRoutes(routes, dependencies.planQuotes);
  if (dependencies.referrals)
    createReferralAdminRoutes(routes, dependencies.referrals);

  routes.post(
    "/applications/:id/approve",
    bodyLimit({
      maxSize: maxApproveBodyBytes,
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
      if (!approveApplicationRequestSchema.safeParse(raw).success)
        throw new ApiError(422, "validation_error");
      return context.json(
        await dependencies.invoices.approveApplication(
          context.get("principal"),
          context.req.param("id"),
        ),
      );
    },
  );

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

  routes.get("/contracts/:id/cancellation", async (context) =>
    context.json(
      await dependencies.admin.getCancellation(context.req.param("id")),
    ),
  );
  routes.post("/contracts/:id/cancellation", async (context) =>
    context.json(
      await dependencies.admin.scheduleCancellation(
        context.get("principal"),
        context.req.param("id"),
      ),
    ),
  );
  routes.delete("/contracts/:id/cancellation", async (context) =>
    context.json(
      await dependencies.admin.revokeCancellation(
        context.get("principal"),
        context.req.param("id"),
      ),
    ),
  );
  routes.put("/contracts/:id/cancellation/checklist", async (context) => {
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
    const checklist = updateCancellationChecklistSchema.safeParse(raw);
    if (!checklist.success) throw new ApiError(422, "validation_error");
    return context.json(
      await dependencies.admin.updateCancellationChecklist(
        context.get("principal"),
        context.req.param("id"),
        checklist.data,
      ),
    );
  });

  routes.get("/invoices", async (context) =>
    context.json(
      await dependencies.invoices.listAdmin(context.get("principal")),
    ),
  );
  routes.post(
    "/invoices/:id/void",
    bodyLimit({
      maxSize: maxVoidInvoiceBodyBytes,
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
      const body = voidInvoiceRequestSchema.safeParse(raw);
      if (!body.success) throw new ApiError(422, "validation_error");
      return context.json(
        await dependencies.invoices.voidInvoice(
          context.get("principal"),
          context.req.param("id"),
          body.data,
        ),
      );
    },
  );
  routes.get("/bank-transfers/pending", async (context) =>
    context.json(
      await dependencies.invoices.listPendingBankTransfers(
        context.get("principal"),
      ),
    ),
  );
  routes.post(
    "/invoices/:id/confirm-payment",
    bodyLimit({
      maxSize: 4 * 1024,
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
      const body = confirmBankPaymentRequestSchema.safeParse(raw);
      if (!body.success) throw new ApiError(422, "validation_error");
      return context.json(
        await dependencies.invoices.confirmBankPayment(
          context.get("principal"),
          context.req.param("id"),
          body.data,
        ),
      );
    },
  );
  routes.get("/invoices/readiness", async (context) =>
    context.json(
      await dependencies.invoices.getReadiness(context.get("principal")),
    ),
  );
  routes.get("/invoices/:id", async (context) =>
    context.json(
      await dependencies.invoices.getAdmin(
        context.get("principal"),
        context.req.param("id"),
      ),
    ),
  );
  routes.get("/invoices/:id/pdf", async (context) => {
    const pdf = await dependencies.invoices.getAdminPdf(
      context.get("principal"),
      context.req.param("id"),
    );
    return context.body(Buffer.from(pdf.content), 200, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${pdf.invoiceNo}.pdf"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
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
