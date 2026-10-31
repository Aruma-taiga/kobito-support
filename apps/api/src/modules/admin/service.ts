import type {
  AdminApplicationQueueQuery,
  DeclineApplicationRequest,
} from "@kobito/shared";
import {
  adminCancellationSchema,
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
