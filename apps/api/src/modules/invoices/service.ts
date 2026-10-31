import {
  extraCreditPurchaseRequestSchema,
  voidInvoiceRequestSchema,
} from "@kobito/shared";
import { z } from "zod";
import type { CustomerScope } from "../../platform/scope.js";
import { ApiError, type Principal } from "../../platform/types.js";
import type { InvoiceModule } from "./contracts.js";

const uuidSchema = z.uuid();

export class InvoiceService implements InvoiceModule {
  constructor(private readonly repository: InvoiceModule) {}

  approveApplication(principal: Principal, applicationId: string) {
    if (!uuidSchema.safeParse(applicationId).success)
      throw new ApiError(404, "not_found");
    return this.repository.approveApplication(principal, applicationId);
  }
  listPendingBankTransfers(principal: Principal) {
    this.requireAdmin(principal);
    return this.repository.listPendingBankTransfers(principal);
  }
  confirmBankPayment(
    principal: Principal,
    invoiceId: string,
    request: Parameters<InvoiceModule["confirmBankPayment"]>[2],
  ) {
    this.requireAdmin(principal);
    if (!uuidSchema.safeParse(invoiceId).success)
      throw new ApiError(404, "not_found");
    return this.repository.confirmBankPayment(principal, invoiceId, request);
  }
  voidInvoice(principal: Principal, invoiceId: string, request: unknown) {
    this.requireAdmin(principal);
    if (!uuidSchema.safeParse(invoiceId).success)
      throw new ApiError(404, "not_found");
    const parsed = voidInvoiceRequestSchema.safeParse(request);
    if (!parsed.success) throw new ApiError(422, "validation_error");
    return this.repository.voidInvoice(principal, invoiceId, parsed.data);
  }
  getCustomerContract(scope: CustomerScope) {
    return this.repository.getCustomerContract(scope);
  }
  purchaseExtraCredits(
    scope: CustomerScope,
    request: unknown,
    idempotencyKey: string,
  ) {
    if (!extraCreditPurchaseRequestSchema.safeParse(request).success)
      throw new ApiError(422, "validation_error");
    if (!/^[\x21-\x7e]{1,128}$/.test(idempotencyKey))
      throw new ApiError(422, "validation_error");
    return this.repository.purchaseExtraCredits(
      scope,
      extraCreditPurchaseRequestSchema.parse(request),
      idempotencyKey,
    );
  }
  getReadiness(principal: Principal) {
    this.requireAdmin(principal);
    return this.repository.getReadiness(principal);
  }
  listCustomer(scope: CustomerScope) {
    return this.repository.listCustomer(scope);
  }
  getCustomer(scope: CustomerScope, invoiceId: string) {
    if (!uuidSchema.safeParse(invoiceId).success)
      throw new ApiError(404, "not_found");
    return this.repository.getCustomer(scope, invoiceId);
  }
  getCustomerPdf(scope: CustomerScope, invoiceId: string) {
    if (!uuidSchema.safeParse(invoiceId).success)
      throw new ApiError(404, "not_found");
    return this.repository.getCustomerPdf(scope, invoiceId);
  }
  listAdmin(principal: Principal) {
    this.requireAdmin(principal);
    return this.repository.listAdmin(principal);
  }
  getAdmin(principal: Principal, invoiceId: string) {
    this.requireAdmin(principal);
    if (!uuidSchema.safeParse(invoiceId).success)
      throw new ApiError(404, "not_found");
    return this.repository.getAdmin(principal, invoiceId);
  }
  getAdminPdf(principal: Principal, invoiceId: string) {
    this.requireAdmin(principal);
    if (!uuidSchema.safeParse(invoiceId).success)
      throw new ApiError(404, "not_found");
    return this.repository.getAdminPdf(principal, invoiceId);
  }

  private requireAdmin(principal: Principal) {
    if (principal.role !== "admin") throw new ApiError(404, "not_found");
    if (!principal.secondFactor) throw new ApiError(403, "forbidden");
  }
}
