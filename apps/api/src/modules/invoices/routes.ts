import { Hono } from "hono";
import { customerScopeFor } from "../../platform/scope.js";
import type { ApiVariables } from "../../platform/types.js";
import type { InvoiceModule } from "./contracts.js";

export function createInvoiceCustomerRoutes(dependencies: {
  invoices: InvoiceModule;
}) {
  const routes = new Hono<{ Variables: ApiVariables }>();
  routes.get("/me/invoices", async (context) => {
    const scope = customerScopeFor(context.get("principal"));
    return context.json(await dependencies.invoices.listCustomer(scope));
  });
  routes.get("/me/invoices/:id", async (context) => {
    const scope = customerScopeFor(context.get("principal"));
    return context.json(
      await dependencies.invoices.getCustomer(scope, context.req.param("id")),
    );
  });
  routes.get("/me/invoices/:id/pdf", async (context) => {
    const scope = customerScopeFor(context.get("principal"));
    const pdf = await dependencies.invoices.getCustomerPdf(
      scope,
      context.req.param("id"),
    );
    return context.body(Buffer.from(pdf.content), 200, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${pdf.invoiceNo}.pdf"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
  });
  return routes;
}
