import type { AdminReferralsResponse, ReferralRewardRow } from "@kobito/shared";
import type { Principal } from "../../platform/types.js";

export interface ReferralModule {
  getAdmin(
    principal: Principal,
    query: unknown,
  ): Promise<AdminReferralsResponse>;
}

export interface ReferralReader {
  /** 対象月（YYYY-MM）の報酬の台帳行。並びはパートナー名、店名の順。 */
  listRewards(month: string): Promise<ReferralRewardRow[]>;
}
