import type {
  PayReferralRewardsRequest,
  PayReferralRewardsResponse,
  ReferralRewardRow,
} from "@kobito/shared";
import type { Pool } from "pg";
import { withAdminAudit } from "../../platform/audit.js";
import type { Principal } from "../../platform/types.js";
import { ApiError } from "../../platform/types.js";
import type { ReferralPaymentWriter, ReferralReader } from "./contracts.js";

interface RewardDbRow {
  reward_id: string;
  partner_id: string;
  partner_name: string;
  referral_code: string;
  shop_name: string;
  reward_type: ReferralRewardRow["rewardType"];
  rate_percent: string;
  month_index: number;
  max_months: number;
  base_amount: number;
  reward_amount: number;
  tax_amount: number;
  paid_on: string | null;
}

/** 顧客情報は店名だけを読み、メール・担当者名などは取り出さない。 */
export class ReferralRepository
  implements ReferralReader, ReferralPaymentWriter
{
  constructor(private readonly pool: Pool) {}

  async listRewards(month: string): Promise<ReferralRewardRow[]> {
    const result = await this.pool.query<RewardDbRow>(
      `select pr.id as reward_id, p.id as partner_id, p.name as partner_name,
              p.referral_code, cu.shop_name, r.reward_type,
              (r.reward_rate * 100)::float8::text as rate_percent,
              pr.month_index, r.max_months, pr.base_amount, pr.reward_amount,
              pr.tax_amount, pr.paid_on::text as paid_on
         from partner_rewards pr
         join referrals r on r.id = pr.referral_id
         join partners p on p.id = r.partner_id
         join contracts c on c.id = r.contract_id
         join customers cu on cu.id = c.customer_id
        where pr.target_month = ($1 || '-01')::date
        order by p.name, p.id, cu.shop_name, pr.id`,
      [month],
    );
    return result.rows.map((row) => ({
      rewardId: row.reward_id,
      partnerId: row.partner_id,
      partnerName: row.partner_name,
      referralCode: row.referral_code,
      shopName: row.shop_name,
      rewardType: row.reward_type,
      rewardRatePercent: Number(row.rate_percent),
      monthIndex: row.month_index,
      maxMonths: row.max_months,
      baseAmount: row.base_amount,
      rewardAmount: row.reward_amount,
      taxAmount: row.tax_amount,
      paidOn: row.paid_on,
    }));
  }

  async payRewards(
    principal: Principal,
    request: PayReferralRewardsRequest,
  ): Promise<PayReferralRewardsResponse> {
    return withAdminAudit(
      this.pool,
      principal,
      {
        action: "partner_reward.paid",
        targetType: "partner",
        targetId: request.partnerId,
        detail: (result) => {
          const paid = result as PayReferralRewardsResponse;
          return { month: request.month, paidCount: String(paid.paidCount) };
        },
      },
      async (client) => {
        const locked = await client.query<{
          id: string;
          reward_amount: number;
          tax_amount: number;
        }>(
          `select pr.id, pr.reward_amount, pr.tax_amount from partner_rewards pr
          join referrals r on r.id = pr.referral_id
         where pr.target_month = ($1 || '-01')::date and r.partner_id = $2 and pr.paid_on is null
         order by pr.id for update of pr`,
          [request.month, request.partnerId],
        );
        if (!locked.rowCount) throw new ApiError(409, "conflict");
        const ids = locked.rows.map((row) => row.id);
        const totalPayable = locked.rows.reduce(
          (sum, row) => sum + row.reward_amount + row.tax_amount,
          0,
        );
        await client.query(
          "update partner_rewards set paid_on=$1 where id=any($2::uuid[]) and paid_on is null",
          [request.paidOn, ids],
        );
        return { paidCount: ids.length, totalPayable };
      },
    );
  }
}
