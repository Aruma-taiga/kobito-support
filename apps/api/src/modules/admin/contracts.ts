import type {
  AdminApplicationQueueQuery,
  AdminApplicationQueueResponse,
  AdminCancellation,
  AdminCustomerDetail,
  AdminNotificationFailureRetryResponse,
  AdminNotificationFailuresResponse,
  AdminPaymentReviewsResponse,
  DeclineApplicationRequest,
  DeclineApplicationResponse,
  UpdateCancellationChecklist,
} from "@kobito/shared";
import type { Principal } from "../../platform/types.js";
import type { InvoiceModule } from "../invoices/contracts.js";

export interface AdminModule {
  listPaymentReviews(query: unknown): Promise<AdminPaymentReviewsResponse>;
  listNotificationFailures(
    query: unknown,
  ): Promise<AdminNotificationFailuresResponse>;
  retryNotificationFailure(
    principal: Principal,
    notificationId: string,
  ): Promise<AdminNotificationFailureRetryResponse>;
  listApplications(
    query: AdminApplicationQueueQuery,
  ): Promise<AdminApplicationQueueResponse>;
  getCustomerDetail(customerId: string): Promise<AdminCustomerDetail>;
  getCancellation(contractId: string): Promise<AdminCancellation>;
  scheduleCancellation(
    principal: Principal,
    contractId: string,
  ): Promise<AdminCancellation>;
  revokeCancellation(
    principal: Principal,
    contractId: string,
  ): Promise<AdminCancellation>;
  updateCancellationChecklist(
    principal: Principal,
    contractId: string,
    checklist: UpdateCancellationChecklist,
  ): Promise<AdminCancellation>;
  declineApplication(
    principal: Principal,
    applicationId: string,
    request: DeclineApplicationRequest,
  ): Promise<DeclineApplicationResponse>;
}

export type { InvoiceModule };
