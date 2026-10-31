import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { Pool } from "pg";
import { createApp } from "./app.js";
import { HttpKomojuClient } from "./integrations/komoju/client.js";
import { LineIdTokenVerifier } from "./integrations/line/verify-id-token.js";
import { PostgresLineRepository } from "./modules/accounts/line/repository.js";
import { LineService } from "./modules/accounts/line/service.js";
import { AccountsRepository } from "./modules/accounts/repository.js";
import { AdminRepository } from "./modules/admin/repository.js";
import { AdminService } from "./modules/admin/service.js";
import { ApplicationsRepository } from "./modules/applications/repository.js";
import { ApplicationsService } from "./modules/applications/service.js";
import { PostgresCustomerAccessRepository } from "./modules/customer-access/repository.js";
import { CustomerAccessService } from "./modules/customer-access/service.js";
import { ChromiumInvoicePdfRenderer } from "./modules/invoices/renderer.js";
import { InvoiceRepository } from "./modules/invoices/repository.js";
import { InvoiceService } from "./modules/invoices/service.js";
import { IssuerSettingsRepository } from "./modules/issuer-settings/repository.js";
import { IssuerSettingsService } from "./modules/issuer-settings/service.js";
import { PostgresPaymentLinkRepository } from "./modules/payment-links/repository.js";
import { PaymentLinkService } from "./modules/payment-links/service.js";
import { PlanQuoteRepository } from "./modules/plan-quotes/repository.js";
import { PlanQuoteService } from "./modules/plan-quotes/service.js";
import { ReferralRepository } from "./modules/referrals/repository.js";
import { ReferralService } from "./modules/referrals/service.js";
import { RequestRepository } from "./modules/requests/repository.js";
import { RequestService } from "./modules/requests/service.js";
import {
  createFirebaseCustomTokenIssuer,
  createFirebaseVerifier,
} from "./platform/auth.js";
import { loadConfig } from "./platform/config.js";
import { consoleLogger } from "./platform/logger.js";
import { PublicSettingsRepository } from "./platform/settings.js";
import { KomojuEventProcessor } from "./webhooks/komoju-processor.js";
import { KomojuInboxRepository } from "./webhooks/komoju-repository.js";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({
    path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  });
}

const config = loadConfig(process.env);
const verifier = createFirebaseVerifier(config);
const pool = new Pool({ connectionString: config.databaseUrl });
const komojuInbox = new KomojuInboxRepository(pool);
const komojuProcessor = new KomojuEventProcessor(komojuInbox);
const accounts = new AccountsRepository(pool);
const applications = new ApplicationsService(
  new ApplicationsRepository(pool),
  config,
);
const invoiceRepository = new InvoiceRepository(
  pool,
  config,
  new ChromiumInvoicePdfRenderer(),
);
const invoices = new InvoiceService(invoiceRepository);
const app = createApp({
  config,
  verifier,
  accounts,
  applications,
  admin: new AdminService(new AdminRepository(pool)),
  issuerSettings: new IssuerSettingsService(new IssuerSettingsRepository(pool)),
  invoices,
  paymentLinks: new PaymentLinkService(
    new PostgresPaymentLinkRepository(pool),
    config.komojuSecretKey
      ? new HttpKomojuClient(config.komojuSecretKey)
      : undefined,
    config.webOrigin,
  ),
  requests: new RequestService(new RequestRepository(pool)),
  planQuotes: new PlanQuoteService(
    new PlanQuoteRepository(pool, invoiceRepository),
  ),
  referrals: new ReferralService(new ReferralRepository(pool)),
  customerAccess: new CustomerAccessService(
    new PostgresCustomerAccessRepository(pool),
  ),
  publicSettings: new PublicSettingsRepository(pool),
  logger: consoleLogger,
  komojuInbox,
  komojuTriggerProcessing: () => komojuProcessor.processPending(),
  ...(config.lineEnabled
    ? {
        line: new LineService(
          new PostgresLineRepository(pool),
          config.lineLoginChannelId
            ? new LineIdTokenVerifier(config.lineLoginChannelId)
            : undefined,
          createFirebaseCustomTokenIssuer(config),
        ),
      }
    : {}),
});

const server = serve({
  fetch: app.fetch,
  hostname: "0.0.0.0",
  port: config.port,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  });
}
