import { createPlanQuoteSchemaFor, toTokyoDate } from "@kobito/shared";
import { z } from "zod";
import type { CustomerScope } from "../../platform/scope.js";
import { ApiError, type Principal } from "../../platform/types.js";
import type { PlanQuoteModule } from "./contracts.js";
import type { PlanQuoteRepository } from "./repository.js";

const uuid = z.uuid();

export class PlanQuoteService implements PlanQuoteModule {
  constructor(
    private readonly repository: PlanQuoteRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  getAdmin(principal: Principal, customerId: string) {
    this.requireAdmin(principal);
    if (!uuid.safeParse(customerId).success)
      throw new ApiError(404, "not_found");
    return this.repository.getAdmin(principal, customerId);
  }

  createAdmin(principal: Principal, customerId: string, body: unknown) {
    this.requireAdmin(principal);
    if (!uuid.safeParse(customerId).success)
      throw new ApiError(404, "not_found");
    const parsed = createPlanQuoteSchemaFor(
      toTokyoDate(this.clock()),
    ).safeParse(body);
    if (!parsed.success) throw new ApiError(422, "validation_error");
    return this.repository.createAdmin(principal, customerId, parsed.data);
  }

  getCustomer(scope: CustomerScope) {
    return this.repository.getCustomer(scope);
  }

  approveCustomer(scope: CustomerScope, principal: Principal, quoteId: string) {
    if (!uuid.safeParse(quoteId).success) throw new ApiError(404, "not_found");
    return this.repository.approveCustomer(scope, principal, quoteId);
  }

  private requireAdmin(principal: Principal) {
    if (principal.role !== "admin") throw new ApiError(404, "not_found");
    if (!principal.secondFactor) throw new ApiError(403, "forbidden");
  }
}
