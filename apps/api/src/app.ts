import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AccountsDataRepository } from "./modules/accounts/repository.js";
import { createAccountsRoutes } from "./modules/accounts/routes.js";
import { AccountsService } from "./modules/accounts/service.js";
import type { AdminModule } from "./modules/admin/contracts.js";
import { createAdminRoutes } from "./modules/admin/routes.js";
import type { ApplicationsModule } from "./modules/applications/contracts.js";
import { createApplicationRoutes } from "./modules/applications/routes.js";
import type { InvoiceModule } from "./modules/invoices/contracts.js";
import { createInvoiceCustomerRoutes } from "./modules/invoices/routes.js";
import {
  type AccountLookup,
  createAuthenticate,
  type IdentityVerifier,
  requireCustomer,
} from "./platform/auth.js";
import type { RuntimeConfig } from "./platform/config.js";
import { toApiDatabaseError } from "./platform/db/errors.js";
import type { ApiLogger } from "./platform/logger.js";
import { requestLogger } from "./platform/logger.js";
import { ApiError, type ApiVariables } from "./platform/types.js";

export interface AppDependencies {
  config: RuntimeConfig;
  verifier: IdentityVerifier;
  accounts: AccountLookup & AccountsDataRepository;
  applications: ApplicationsModule;
  admin: AdminModule;
  invoices: InvoiceModule;
  publicSettings: { getServiceName(): Promise<string> };
  logger: ApiLogger;
}

export function createApp(dependencies: AppDependencies) {
  const app = new Hono<{ Variables: ApiVariables }>();
  const authenticate = createAuthenticate(
    dependencies.verifier,
    dependencies.accounts,
  );

  app.use("*", requestLogger(dependencies.logger));
  app.use(
    "*",
    cors({
      origin: dependencies.config.webOrigin,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
      maxAge: 600,
    }),
  );

  app.onError((error, context) => {
    const apiError =
      error instanceof ApiError ? error : toApiDatabaseError(error);
    return context.json({ error: { code: apiError.code } }, apiError.status);
  });
  app.notFound((context) =>
    context.json({ error: { code: "not_found" } }, 404),
  );

  app.get("/healthz", (context) => context.json({ status: "ok" }));
  app.get("/api/v1/public/config", async (context) => {
    const [serviceName, catalog] = await Promise.all([
      dependencies.publicSettings.getServiceName(),
      dependencies.applications.getPublicCatalog(),
    ]);
    return context.json({ serviceName, application: catalog.application });
  });

  app.use("/api/v1/me", authenticate, requireCustomer());
  app.use("/api/v1/me/*", authenticate, requireCustomer());
  app.route(
    "/api/v1",
    createAccountsRoutes(new AccountsService(dependencies.accounts)),
  );
  app.route(
    "/api/v1",
    createApplicationRoutes({
      verifier: dependencies.verifier,
      applications: dependencies.applications,
    }),
  );

  app.route(
    "/api/v1",
    createInvoiceCustomerRoutes({ invoices: dependencies.invoices }),
  );

  app.route(
    "/api/v1/admin",
    createAdminRoutes({
      admin: dependencies.admin,
      verifier: dependencies.verifier,
      accounts: dependencies.accounts,
      invoices: dependencies.invoices,
    }),
  );

  return app;
}
