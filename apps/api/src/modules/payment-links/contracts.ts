import type { CustomerScope } from "../../platform/scope.js";

export interface PaymentLinkInvoice {
  invoiceNo: string;
  amountYen: number;
  paymentMethod: string;
  status: string;
}

export interface PaymentLinkRepository {
  getCustomerInvoice(
    scope: CustomerScope,
    invoiceId: string,
  ): Promise<PaymentLinkInvoice>;
  recordCustomerLinkCreated(
    scope: CustomerScope,
    authUserId: string,
    invoiceId: string,
  ): Promise<void>;
}

export interface PaymentLinkModule {
  create(
    principal: {
      authUserId: string;
      role: "customer" | "admin";
      customerId: string | null;
      secondFactor: string | null;
    },
    invoiceId: string,
  ): Promise<{ redirectUrl: string }>;
}
