import {
  adminReferralsQuerySchema,
  buildReferralReport,
  payReferralRewardsRequestSchema,
  toTokyoDate,
} from "@kobito/shared";
import { ApiError, type Principal } from "../../platform/types.js";
import type {
  ReferralModule,
  ReferralPaymentWriter,
  ReferralReader,
} from "./contracts.js";

export class ReferralService implements ReferralModule {
  constructor(
    private readonly repository: ReferralReader & ReferralPaymentWriter,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getAdmin(principal: Principal, query: unknown) {
    if (principal.role !== "admin") throw new ApiError(404, "not_found");
    if (!principal.secondFactor) throw new ApiError(403, "forbidden");
    const parsed = adminReferralsQuerySchema.safeParse(query);
    if (!parsed.success) throw new ApiError(422, "validation_error");
    const month =
      parsed.data.month ?? toTokyoDate(this.clock()).slice(0, "YYYY-MM".length);
    return buildReferralReport(month, await this.repository.listRewards(month));
  }

  async payAdmin(principal: Principal, request: unknown) {
    if (principal.role !== "admin") throw new ApiError(404, "not_found");
    if (!principal.secondFactor) throw new ApiError(403, "forbidden");
    const parsed = payReferralRewardsRequestSchema.safeParse(request);
    if (!parsed.success) throw new ApiError(422, "validation_error");
    const today = toTokyoDate(this.clock());
    if (
      parsed.data.paidOn > today ||
      parsed.data.paidOn < `${parsed.data.month}-01`
    )
      throw new ApiError(422, "validation_error");
    return this.repository.payRewards(principal, parsed.data);
  }
}
