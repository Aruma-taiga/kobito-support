import { Hono } from "hono";
import { cors } from "hono/cors";
import type { LineModule } from "./modules/accounts/line/contracts.js";
import {
  createLineCustomerRoutes,
  createLinePublicRoutes,
} from "./modules/accounts/line/routes.js";
import type { AccountsDataRepository } from "./modules/accounts/repository.js";
import { createAccountsRoutes } from "./modules/accounts/routes.js";
import { AccountsService } from "./modules/accounts/service.js";
import type { AdminModule } from "./modules/admin/contracts.js";
import { createAdminRoutes } from "./modules/admin/routes.js";
import type { ApplicationsModule } from "./modules/applications/contracts.js";
import { createApplicationRoutes } from "./modules/applications/routes.js";
import type { CustomerAccessModule } from "./modules/customer-access/contracts.js";
import { requireCustomerAccess } from "./modules/customer-access/guard.js";
import { createCustomerAccessRoutes } from "./modules/customer-access/routes.js";
import type { InvoiceModule } from "./modules/invoices/contracts.js";
import { createInvoiceCustomerRoutes } from "./modules/invoices/routes.js";
import type { IssuerSettingsModule } from "./modules/issuer-settings/contracts.js";
import { createAdminIssuerSettingsRoutes } from "./modules/issuer-settings/routes.js";
import type { RequestModule } from "./modules/requests/contracts.js";
import { createRequestCustomerRoutes } from "./modules/requests/routes.js";
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
import type { KomojuInbox } from "./webhooks/komoju-contracts.js";
import { createKomojuWebhookRoutes } from "./webhooks/komoju-routes.js";

export interface AppDependencies {
  config: RuntimeConfig;
  verifier: IdentityVerifier;
  accounts: AccountLookup & AccountsDataRepository;
  applications: ApplicationsModule;
  admin: AdminModule;
  issuerSettings?: IssuerSettingsModule;
  invoices: InvoiceModule;
  requests?: RequestModule;
  customerAccess: CustomerAccessModule;
  publicSettings: {
    getServiceName(): Promise<string>;
    getContactEmail(): Promise<string | null>;
  };
  logger: ApiLogger;
  komojuInbox: KomojuInbox;
  line?: LineModule;
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
  app.route(
    "/",
    createKomojuWebhookRoutes({
      secret: dependencies.config.komojuWebhookSecret,
      inbox: dependencies.komojuInbox,
    }),
  );
  const lineRoutesEnabled =
    dependencies.config.lineEnabled === true && dependencies.line !== undefined;
  if (dependencies.line && lineRoutesEnabled) {
    app.route("/api/v1", createLinePublicRoutes(dependencies.line));
  }
  app.get("/api/v1/public/config", async (context) => {
    const [serviceName, contactEmail, catalog] = await Promise.all([
      dependencies.publicSettings.getServiceName(),
      dependencies.publicSettings.getContactEmail(),
      dependencies.applications.getPublicCatalog(),
    ]);
    return context.json({
      serviceName,
      ...(contactEmail ? { contactEmail } : {}),
      application: catalog.application,
    });
  });

  app.use(
    "/api/v1/me",
    authenticate,
    requireCustomer(),
    requireCustomerAccess(dependencies.customerAccess),
  );
  app.use(
    "/api/v1/me/*",
    authenticate,
    requireCustomer(),
    requireCustomerAccess(dependencies.customerAccess),
  );
  if (dependencies.line && lineRoutesEnabled)
    app.route("/api/v1", createLineCustomerRoutes(dependencies.line));
  app.route("/api/v1", createCustomerAccessRoutes(dependencies.customerAccess));
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
  if (dependencies.requests)
    app.route("/api/v1", createRequestCustomerRoutes(dependencies.requests));

  if (dependencies.issuerSettings) {
    app.route(
      "/api/v1/admin/settings",
      createAdminIssuerSettingsRoutes({
        verifier: dependencies.verifier,
        accounts: dependencies.accounts,
        issuerSettings: dependencies.issuerSettings,
      }),
    );
  }

  app.route(
    "/api/v1/admin",
    createAdminRoutes({
      admin: dependencies.admin,
      verifier: dependencies.verifier,
      accounts: dependencies.accounts,
      invoices: dependencies.invoices,
      ...(dependencies.requests ? { requests: dependencies.requests } : {}),
    }),
  );

  return app;
}
