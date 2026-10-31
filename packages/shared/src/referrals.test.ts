import { describe, expect, it } from "vitest";
import {
  adminReferralsQuerySchema,
  adminReferralsResponseSchema,
  buildReferralReport,
  type ReferralRewardRow,
  rewardPayableYen,
} from "./referrals.js";

const row = (over: Partial<ReferralRewardRow> = {}): ReferralRewardRow => ({
  rewardId: "r1",
  partnerId: "p1",
  partnerName: "佐藤さん",
  referralCode: "SP-0012",
  shopName: "喫茶ひだまり",
  rewardType: "closing",
  rewardRatePercent: 20,
  monthIndex: 1,
  maxMonths: 12,
  baseAmount: 5000,
  rewardAmount: 1000,
  taxAmount: 100,
  paidOn: null,
  ...over,
});

describe("referral month query", () => {
  it("accepts YYYY-MM and an omitted month", () => {
    expect(adminReferralsQuerySchema.safeParse({}).success).toBe(true);
    expect(
      adminReferralsQuerySchema.safeParse({ month: "2026-11" }).success,
    ).toBe(true);
  });
  it.each([
    "2026-13",
    "2026-00",
    "2026-1",
    "2026-11-01",
    "abc",
    "",
  ])("rejects %s", (month) => {
    expect(adminReferralsQuerySchema.safeParse({ month }).success).toBe(false);
  });
  it("rejects unknown keys", () => {
    expect(adminReferralsQuerySchema.safeParse({ x: "1" }).success).toBe(false);
  });
});

describe("buildReferralReport", () => {
  it("pays reward plus the stored tax without recomputing it", () => {
    expect(rewardPayableYen(1000, 100)).toBe(1100);
    // 税額は DB の値を信頼する（500円の10%は50円だが、保存値0円を使う）
    expect(rewardPayableYen(500, 0)).toBe(500);
  });

  it("groups by partner with subtotals and a month total", () => {
    const report = buildReferralReport("2026-11", [
      row({ rewardId: "a" }),
      row({
        rewardId: "b",
        shopName: "カフェ あおば",
        baseAmount: 15000,
        rewardAmount: 3000,
        taxAmount: 300,
      }),
      row({
        rewardId: "c",
        partnerId: "p2",
        partnerName: "伊藤さん",
        referralCode: "SP-0003",
        shopName: "整体院 こはる",
        rewardType: "appointment",
        rewardRatePercent: 10,
        baseAmount: 5000,
        rewardAmount: 500,
        taxAmount: 50,
        paidOn: "2026-12-05",
      }),
    ]);
    expect(report.month).toBe("2026-11");
    expect(report.partners).toHaveLength(2);
    const first = report.partners[0];
    expect(first?.rows.map((r) => r.payableAmount)).toEqual([1100, 3300]);
    expect(first?.subtotal).toEqual({
      count: 2,
      baseAmount: 20000,
      rewardAmount: 4000,
      taxAmount: 400,
      payableAmount: 4400,
    });
    expect(report.partners[1]?.rows[0]?.status).toBe("paid");
    expect(first?.rows[0]?.status).toBe("unpaid");
    expect(report.total).toEqual({
      count: 3,
      baseAmount: 25000,
      rewardAmount: 4500,
      taxAmount: 450,
      payableAmount: 4950,
    });
    expect(adminReferralsResponseSchema.safeParse(report).success).toBe(true);
  });

  it("returns zero totals for no rows", () => {
    const report = buildReferralReport("2026-11", []);
    expect(report.partners).toEqual([]);
    expect(report.total.payableAmount).toBe(0);
    expect(report.total.count).toBe(0);
  });
});
