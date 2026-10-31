import type { ReferralRewardRow } from "@kobito/shared";
import type { Pool } from "pg";
import type { ReferralReader } from "./contracts.js";

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

/** 閲覧のみ。顧客は店名だけを取り出し、メール・担当者名などは読まない。 */
export class ReferralRepository implements ReferralReader {
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
}
