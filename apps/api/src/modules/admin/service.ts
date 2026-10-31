import type {
  AdminApplicationQueueQuery,
  DeclineApplicationRequest,
} from "@kobito/shared";
import {
  adminCancellationSchema,
  adminNotificationFailureIdSchema,
  adminNotificationFailureRetryResponseSchema,
  adminNotificationFailuresQuerySchema,
  adminNotificationFailuresResponseSchema,
  adminPaymentReviewIdSchema,
  adminPaymentReviewResolveRequestSchema,
  adminPaymentReviewResolveResponseSchema,
  adminPaymentReviewsQuerySchema,
  adminPaymentReviewsResponseSchema,
} from "@kobito/shared";
import { z } from "zod";
import { ApiError, type Principal } from "../../platform/types.js";
import type { AdminModule } from "./contracts.js";
import type { AdminRepository } from "./repository.js";

const uuidSchema = z.uuid();

export class AdminService implements AdminModule {
  constructor(private readonly repository: AdminRepository) {}

  async listPaymentReviews(query: unknown) {
    const parsed = adminPaymentReviewsQuerySchema.safeParse(query);
    if (!parsed.success) throw new ApiError(422, "validation_error");
    return adminPaymentReviewsResponseSchema.parse(
      await this.repository.listPaymentReviews(parsed.data),
    );
  }

  async listNotificationFailures(query: unknown) {
    const parsed = adminNotificationFailuresQuerySchema.safeParse(query);
    if (!parsed.success) throw new ApiError(422, "validation_error");
    return adminNotificationFailuresResponseSchema.parse(
      await this.repository.listNotificationFailures(parsed.data),
    );
  }

  async resolvePaymentReview(
    principal: Principal,
    eventId: string,
    request: unknown,
  ) {
    if (!adminPaymentReviewIdSchema.safeParse(eventId).success)
      throw new ApiError(404, "not_found");
    const parsed = adminPaymentReviewResolveRequestSchema.safeParse(request);
    if (!parsed.success) throw new ApiError(422, "validation_error");
    return adminPaymentReviewResolveResponseSchema.parse(
      await this.repository.resolvePaymentReview(
        principal,
        eventId,
        parsed.data,
      ),
    );
  }

  async retryNotificationFailure(principal: Principal, notificationId: string) {
    if (!adminNotificationFailureIdSchema.safeParse(notificationId).success)
      throw new ApiError(404, "not_found");
    return adminNotificationFailureRetryResponseSchema.parse(
      await this.repository.retryNotificationFailure(principal, notificationId),
    );
  }

  async getCancellation(contractId: string) {
    if (!uuidSchema.safeParse(contractId).success)
      throw new ApiError(404, "not_found");
    return adminCancellationSchema.parse(
      await this.repository.getCancellation(contractId),
    );
  }

  async scheduleCancellation(principal: Principal, contractId: string) {
    if (!uuidSchema.safeParse(contractId).success)
      throw new ApiError(404, "not_found");
    return adminCancellationSchema.parse(
      await this.repository.scheduleCancellation(principal, contractId),
    );
  }

  async revokeCancellation(principal: Principal, contractId: string) {
    if (!uuidSchema.safeParse(contractId).success)
      throw new ApiError(404, "not_found");
    return adminCancellationSchema.parse(
      await this.repository.revokeCancellation(principal, contractId),
    );
  }

  async updateCancellationChecklist(
    principal: Principal,
    contractId: string,
    checklist: import("@kobito/shared").UpdateCancellationChecklist,
  ) {
    if (!uuidSchema.safeParse(contractId).success)
      throw new ApiError(404, "not_found");
    return adminCancellationSchema.parse(
      await this.repository.updateCancellationChecklist(
        principal,
        contractId,
        checklist,
      ),
    );
  }

  listApplications(query: AdminApplicationQueueQuery) {
    return this.repository.listApplications(query);
  }

  getCustomerDetail(customerId: string) {
    if (!uuidSchema.safeParse(customerId).success) {
      throw new ApiError(404, "not_found");
    }
    return this.repository.getCustomerDetail(customerId);
  }

  declineApplication(
    principal: Principal,
    applicationId: string,
    request: DeclineApplicationRequest,
  ) {
    if (!uuidSchema.safeParse(applicationId).success) {
      throw new ApiError(404, "not_found");
    }
    return this.repository.declineApplication(
      principal,
      applicationId,
      request,
    );
  }
}
