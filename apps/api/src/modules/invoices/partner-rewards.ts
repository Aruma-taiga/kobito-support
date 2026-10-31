import { calculatePartnerReward } from "@kobito/shared";
import type { PoolClient } from "pg";

/**
 * Records an earned reward in the payment transaction. Provisional tax assumes
 * the partner is a taxable business: reward tax is floored at 10%.
 */
export async function recordPartnerReward(
  client: PoolClient,
  input: {
    contractId: string;
    invoiceId: string;
    paymentId: string;
    paidOn: string;
  },
): Promise<void> {
  const contractResult = await client.query<{
    status: string;
    cancel_requested_at: string | null;
    partner_id: string | null;
    reward_type: "appointment" | "closing";
    reward_rate: string;
    max_months: number;
  }>(
    `select c.status, c.cancel_requested_at::text, r.partner_id, r.reward_type, r.reward_rate::text, r.max_months
       from contracts c left join referrals r on r.contract_id=c.id
      where c.id=$1 for update of c`,
    [input.contractId],
  );
  const contract = contractResult.rows[0];
  if (
    !contract ||
    contract.status !== "active" ||
    contract.cancel_requested_at !== null ||
    !contract.partner_id
  )
    return;

  const invoiceResult = await client.query<{
    kind: string;
    period_id: string | null;
  }>(`select kind, period_id from invoices where id=$1 and contract_id=$2`, [
    input.invoiceId,
    input.contractId,
  ]);
  const invoice = invoiceResult.rows[0];
  if (
    !invoice ||
    !["initial", "monthly"].includes(invoice.kind) ||
    !invoice.period_id
  )
    return;

  const periodResult = await client.query<{ price_excl_tax: number }>(
    `select price_excl_tax from billing_periods where id=$1 and contract_id=$2`,
    [invoice.period_id, input.contractId],
  );
  const baseAmount = periodResult.rows[0]?.price_excl_tax;
  if (!Number.isSafeInteger(baseAmount) || (baseAmount as number) <= 0) return;

  const countResult = await client.query<{ count: number }>(
    "select count(*)::int as count from partner_rewards where referral_id=(select id from referrals where contract_id=$1)",
    [input.contractId],
  );
  const monthIndex = (countResult.rows[0]?.count ?? 0) + 1;
  if (monthIndex > contract.max_months) return;

  const amounts = calculatePartnerReward(
    Number(baseAmount),
    Number(contract.reward_rate),
  );
  const targetMonth = `${input.paidOn.slice(0, 7)}-01`;
  await client.query(
    `insert into partner_rewards
       (referral_id,payment_id,target_month,month_index,base_amount,reward_amount,tax_amount)
     values ((select id from referrals where contract_id=$1),$2,$3,$4,$5,$6,$7)
     on conflict (payment_id) do nothing`,
    [
      input.contractId,
      input.paymentId,
      targetMonth,
      monthIndex,
      amounts.baseAmount,
      amounts.rewardAmount,
      amounts.taxAmount,
    ],
  );
}
