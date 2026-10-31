import type {
  ApproveApplicationResponse,
  ConfirmBankPaymentRequest,
  ConfirmBankPaymentResponse,
  CustomerContractResponse,
  ExtraCreditPurchaseRequest,
  ExtraCreditPurchaseResponse,
  InvoiceDetail,
  InvoiceList,
  InvoiceReadiness,
  PendingBankTransfers,
} from "@kobito/shared";
import type { CustomerScope } from "../../platform/scope.js";
import type { Principal } from "../../platform/types.js";

export interface InvoiceModule {
  getReadiness(principal: Principal): Promise<InvoiceReadiness>;
  approveApplication(
    principal: Principal,
    applicationId: string,
  ): Promise<ApproveApplicationResponse>;
  listCustomer(scope: CustomerScope): Promise<InvoiceList>;
  getCustomer(scope: CustomerScope, invoiceId: string): Promise<InvoiceDetail>;
  getCustomerPdf(
    scope: CustomerScope,
    invoiceId: string,
  ): Promise<{ invoiceNo: string; content: Uint8Array }>;
  listAdmin(principal: Principal): Promise<InvoiceList>;
  getAdmin(principal: Principal, invoiceId: string): Promise<InvoiceDetail>;
  getAdminPdf(
    principal: Principal,
    invoiceId: string,
  ): Promise<{ invoiceNo: string; content: Uint8Array }>;
  listPendingBankTransfers(principal: Principal): Promise<PendingBankTransfers>;
  confirmBankPayment(
    principal: Principal,
    invoiceId: string,
    request: ConfirmBankPaymentRequest,
  ): Promise<ConfirmBankPaymentResponse>;
  getCustomerContract(scope: CustomerScope): Promise<CustomerContractResponse>;
  purchaseExtraCredits(
    scope: CustomerScope,
    request: ExtraCreditPurchaseRequest,
    idempotencyKey: string,
  ): Promise<ExtraCreditPurchaseResponse>;
}
