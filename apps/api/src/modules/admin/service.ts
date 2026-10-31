import type {
  AdminApplicationQueueQuery,
  DeclineApplicationRequest,
} from "@kobito/shared";
import {
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
