import type {
  AdminApplicationQueueQuery,
  AdminApplicationQueueResponse,
  AdminCustomerDetail,
  AdminPaymentReviewsResponse,
  DeclineApplicationRequest,
  DeclineApplicationResponse,
} from "@kobito/shared";
import type { Principal } from "../../platform/types.js";
import type { InvoiceModule } from "../invoices/contracts.js";

export interface AdminModule {
  listPaymentReviews(query: unknown): Promise<AdminPaymentReviewsResponse>;
  listApplications(
    query: AdminApplicationQueueQuery,
  ): Promise<AdminApplicationQueueResponse>;
  getCustomerDetail(customerId: string): Promise<AdminCustomerDetail>;
  declineApplication(
    principal: Principal,
    applicationId: string,
    request: DeclineApplicationRequest,
  ): Promise<DeclineApplicationResponse>;
}

export type { InvoiceModule };
