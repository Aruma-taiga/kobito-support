import {
  adminReferralsQuerySchema,
  buildReferralReport,
  toTokyoDate,
} from "@kobito/shared";
import { ApiError, type Principal } from "../../platform/types.js";
import type { ReferralModule, ReferralReader } from "./contracts.js";

export class ReferralService implements ReferralModule {
  constructor(
    private readonly repository: ReferralReader,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getAdmin(principal: Principal, query: unknown) {
    if (principal.role !== "admin") throw new ApiError(404, "not_found");
    if (!principal.secondFactor) throw new ApiError(403, "forbidden");
    const parsed = adminReferralsQuerySchema.safeParse(query);
    if (!parsed.success) throw new ApiError(400, "invalid_request");
    const month =
      parsed.data.month ?? toTokyoDate(this.clock()).slice(0, "YYYY-MM".length);
    return buildReferralReport(month, await this.repository.listRewards(month));
  }
}
