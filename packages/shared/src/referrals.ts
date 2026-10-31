import { z } from "zod";
import { taxOnExcl } from "./pricing.js";

/** 紹介・報酬（管理画面 a08）。閲覧用。報酬の消費税は台帳（DB）の値を信頼し、計算し直さない。 */

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
export const referralMonthSchema = z.string().regex(monthPattern);

export const adminReferralsQuerySchema = z
  .object({ month: referralMonthSchema.optional() })
  .strict();
export type AdminReferralsQuery = z.infer<typeof adminReferralsQuerySchema>;

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day || month > 12) return false;
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [
      31,
      leapYear ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ];
    return day <= (daysInMonth[month - 1] ?? 0);
  });
export const payReferralRewardsRequestSchema = z
  .object({
    month: referralMonthSchema,
    partnerId: z.string().uuid(),
    paidOn: calendarDate,
  })
  .strict();
export type PayReferralRewardsRequest = z.infer<
  typeof payReferralRewardsRequestSchema
>;
export const payReferralRewardsResponseSchema = z
  .object({
    paidCount: z.number().int().positive(),
    totalPayable: z.number().int().nonnegative(),
  })
  .strict();
export type PayReferralRewardsResponse = z.infer<
  typeof payReferralRewardsResponseSchema
>;

export const referralRewardTypes = ["appointment", "closing"] as const;
export type ReferralRewardType = (typeof referralRewardTypes)[number];

/** Tax-exclusive partner reward and provisional 10% tax, both rounded down. */
export function calculatePartnerReward(baseAmount: number, rewardRate: number) {
  if (!Number.isSafeInteger(baseAmount) || baseAmount < 0) {
    throw new RangeError("Base amount must be a non-negative safe integer");
  }
  if (!Number.isFinite(rewardRate) || rewardRate < 0 || rewardRate > 1) {
    throw new RangeError("Reward rate must be between zero and one");
  }
  const rewardAmount = Math.floor(baseAmount * rewardRate);
  return {
    baseAmount,
    rewardAmount,
    taxAmount: taxOnExcl(rewardAmount),
  };
}

const yen = z.number().int().nonnegative();

export const referralAmountsSchema = z
  .object({
    count: z.number().int().nonnegative(),
    /** 基準額の合計（月額基本料・表示価格・税抜） */
    baseAmount: yen,
    /** 報酬（税抜）の合計 */
    rewardAmount: yen,
    /** 消費税の合計（台帳の値の合計） */
    taxAmount: yen,
    /** 支払い額＝報酬（税抜）＋消費税 */
    payableAmount: yen,
    /** 未払い行の報酬（税抜）＋消費税 */
    unpaidPayableAmount: yen,
    /** 支払済み行の報酬（税抜）＋消費税 */
    paidPayableAmount: yen,
  })
  .strict();
export type ReferralAmounts = z.infer<typeof referralAmountsSchema>;

export const referralRewardLineSchema = z
  .object({
    rewardId: z.string().min(1),
    shopName: z.string(),
    rewardType: z.enum(referralRewardTypes),
    /** 率（%）。10 または 20 */
    ratePercent: z.number().nonnegative(),
    monthIndex: z.number().int().positive(),
    maxMonths: z.number().int().positive(),
    baseAmount: yen,
    rewardAmount: yen,
    taxAmount: yen,
    payableAmount: yen,
    status: z.enum(["paid", "unpaid"]),
    paidOn: z.string().nullable(),
  })
  .strict();
export type ReferralRewardLine = z.infer<typeof referralRewardLineSchema>;

export const referralPartnerGroupSchema = z
  .object({
    partnerId: z.string().min(1),
    partnerName: z.string(),
    referralCode: z.string(),
    rows: z.array(referralRewardLineSchema),
    subtotal: referralAmountsSchema,
  })
  .strict();
export type ReferralPartnerGroup = z.infer<typeof referralPartnerGroupSchema>;

export const adminReferralsResponseSchema = z
  .object({
    month: referralMonthSchema,
    partners: z.array(referralPartnerGroupSchema),
    total: referralAmountsSchema,
  })
  .strict();
export type AdminReferralsResponse = z.infer<
  typeof adminReferralsResponseSchema
>;

/** DB から読んだ1件ぶんの台帳行（集計前）。 */
export interface ReferralRewardRow {
  rewardId: string;
  partnerId: string;
  partnerName: string;
  referralCode: string;
  shopName: string;
  rewardType: ReferralRewardType;
  rewardRatePercent: number;
  monthIndex: number;
  maxMonths: number;
  baseAmount: number;
  rewardAmount: number;
  taxAmount: number;
  paidOn: string | null;
}

/** 支払い額＝報酬（税抜）＋消費税。消費税は台帳の値をそのまま使う。 */
export function rewardPayableYen(rewardAmount: number, taxAmount: number) {
  return rewardAmount + taxAmount;
}

function sumAmounts(lines: readonly ReferralRewardLine[]): ReferralAmounts {
  const totals = { baseAmount: 0, rewardAmount: 0, taxAmount: 0 };
  for (const line of lines) {
    totals.baseAmount += line.baseAmount;
    totals.rewardAmount += line.rewardAmount;
    totals.taxAmount += line.taxAmount;
  }
  return {
    count: lines.length,
    ...totals,
    payableAmount: rewardPayableYen(totals.rewardAmount, totals.taxAmount),
    unpaidPayableAmount: lines.reduce(
      (sum, line) => sum + (line.status === "unpaid" ? line.payableAmount : 0),
      0,
    ),
    paidPayableAmount: lines.reduce(
      (sum, line) => sum + (line.status === "paid" ? line.payableAmount : 0),
      0,
    ),
  };
}

/** 月の台帳行をパートナーごとにまとめ、小計と月の合計を出す（合算はここだけ）。 */
export function buildReferralReport(
  month: string,
  rows: readonly ReferralRewardRow[],
): AdminReferralsResponse {
  const groups = new Map<string, ReferralPartnerGroup>();
  const lines: ReferralRewardLine[] = [];
  for (const row of rows) {
    const line: ReferralRewardLine = {
      rewardId: row.rewardId,
      shopName: row.shopName,
      rewardType: row.rewardType,
      ratePercent: row.rewardRatePercent,
      monthIndex: row.monthIndex,
      maxMonths: row.maxMonths,
      baseAmount: row.baseAmount,
      rewardAmount: row.rewardAmount,
      taxAmount: row.taxAmount,
      payableAmount: rewardPayableYen(row.rewardAmount, row.taxAmount),
      status: row.paidOn ? "paid" : "unpaid",
      paidOn: row.paidOn,
    };
    lines.push(line);
    let group = groups.get(row.partnerId);
    if (!group) {
      group = {
        partnerId: row.partnerId,
        partnerName: row.partnerName,
        referralCode: row.referralCode,
        rows: [],
        subtotal: sumAmounts([]),
      };
      groups.set(row.partnerId, group);
    }
    group.rows.push(line);
  }
  const partners = [...groups.values()].map((group) => ({
    ...group,
    subtotal: sumAmounts(group.rows),
  }));
  return { month, partners, total: sumAmounts(lines) };
}
