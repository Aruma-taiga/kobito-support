import { z } from "zod";
import type { KomojuClient } from "../../integrations/komoju/client.js";
import { type CustomerScope, customerScopeFor } from "../../platform/scope.js";
import { ApiError, type Principal } from "../../platform/types.js";
import type { PaymentLinkModule, PaymentLinkRepository } from "./contracts.js";

const uuidSchema = z.uuid();

export class PaymentLinkService implements PaymentLinkModule {
  constructor(
    private readonly repository: PaymentLinkRepository,
    private readonly komoju: KomojuClient | undefined,
    private readonly webOrigin: string,
  ) {}

  async create(principal: Principal, invoiceId: string) {
    if (!uuidSchema.safeParse(invoiceId).success)
      throw new ApiError(404, "not_found");
    const scope: CustomerScope = customerScopeFor(principal);
    const invoice = await this.repository.getCustomerInvoice(scope, invoiceId);
    if (invoice.paymentMethod !== "card" || invoice.status !== "issued")
      throw new ApiError(409, "conflict");
    if (!this.komoju) throw new ApiError(503, "payment_link_unavailable");

    let session: { sessionId: string; redirectUrl: string };
    try {
      session = await this.komoju.createHostedSession({
        invoiceNo: invoice.invoiceNo,
        amountYen: invoice.amountYen,
        returnUrl: new URL(
          `/me/invoices/${encodeURIComponent(invoiceId)}`,
          this.webOrigin,
        ).toString(),
      });
    } catch {
      throw new ApiError(502, "payment_link_failed");
    }
    await this.repository.recordCustomerLinkCreated(
      scope,
      principal.authUserId,
      invoiceId,
    );
    return { redirectUrl: session.redirectUrl };
  }
}
