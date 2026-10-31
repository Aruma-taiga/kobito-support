import {
  type AdminReferralsResponse,
  type PayReferralRewardsRequest,
  type ReferralRewardLine,
  webMessages,
} from "@kobito/shared";
import { useEffect, useState } from "react";
import type { AdminApiClient } from "../platform/admin-api-client.js";
import { formatSlashDate, formatYen } from "../platform/format.js";
import {
  AdminHeading,
  Badge,
  Block,
  Button,
  Field,
  Hint,
  Notice,
  StatTiles,
  Table,
} from "../ui/index.js";

/** 2026-11 を delta か月ずらす。 */
function shiftMonth(month: string, delta: number): string {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  const index = year * 12 + (mon - 1) + delta;
  const nextYear = Math.floor(index / 12);
  return `${String(nextYear).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [year, mon] = month.split("-");
  return `${year}年${Number(mon)}月`;
}

function typeLabel(line: ReferralRewardLine): string {
  const template =
    line.rewardType === "appointment"
      ? webMessages.adminReferralsTypeAppointment
      : webMessages.adminReferralsTypeClosing;
  return template.replace("{rate}", String(line.ratePercent));
}

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; report: AdminReferralsResponse };

/** a08 紹介・報酬。基準額は税抜、支払い額は報酬（税抜）＋消費税。 */
export function AdminReferralsPage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  const [requested, setRequested] = useState<string | undefined>(undefined);
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [paymentDate, setPaymentDate] = useState(todayTokyo());
  const [paying, setPaying] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState(false);

  // attempt は同じ月を取り直すための再読み込みの合図
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally retries the fetch
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    apiClient.getAdminReferrals(requested).then(
      (report) => {
        if (current) setState({ status: "ready", report });
      },
      () => {
        if (current) setState({ status: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [apiClient, requested, attempt]);

  const shown =
    requested ?? (state.status === "ready" ? state.report.month : undefined);
  const go = (delta: number) => {
    const base = state.status === "ready" ? state.report.month : requested;
    if (base) setRequested(shiftMonth(base, delta));
  };

  return (
    <>
      <AdminHeading
        id="referrals-title"
        title={webMessages.adminReferralsTitle}
        badge={shown ? monthLabel(shown) : undefined}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={!shown}
              onClick={() => go(-1)}
            >
              {webMessages.adminReferralsPrevMonth}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!shown}
              onClick={() => go(1)}
            >
              {webMessages.adminReferralsNextMonth}
            </Button>
          </>
        }
      />
      {state.status === "loading" ? (
        <output className="ui-admin__lead">
          {webMessages.adminReferralsLoading}
        </output>
      ) : null}
      {state.status === "error" ? (
        <>
          <Notice tone="warn">{webMessages.adminReferralsError}</Notice>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {webMessages.invoiceRetry}
          </Button>
        </>
      ) : null}
      {state.status === "ready" ? (
        <>
          {paymentError ? (
            <Notice tone="warn">{webMessages.adminReferralsPayError}</Notice>
          ) : null}
          <Report
            report={state.report}
            paymentDate={paymentDate}
            setPaymentDate={setPaymentDate}
            paying={paying}
            onPay={async (request) => {
              if (paying) return;
              const partner = state.report.partners.find(
                (item) => item.partnerId === request.partnerId,
              );
              if (!partner) return;
              const confirmText = webMessages.adminReferralsPayConfirm
                .replace(
                  "{amount}",
                  formatYen(partner.subtotal.unpaidPayableAmount),
                )
                .replace("{partner}", partner.partnerName);
              if (!window.confirm(confirmText)) return;
              setPaying(request.partnerId);
              setPaymentError(false);
              try {
                await apiClient.payAdminReferralRewards(request);
                setAttempt((value) => value + 1);
              } catch {
                setPaymentError(true);
              } finally {
                setPaying(null);
              }
            }}
          />
        </>
      ) : null}
    </>
  );
}

function todayTokyo() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function Report({
  report,
  paymentDate,
  setPaymentDate,
  paying,
  onPay,
}: {
  report: AdminReferralsResponse;
  paymentDate: string;
  setPaymentDate: (date: string) => void;
  paying: string | null;
  onPay: (request: PayReferralRewardsRequest) => Promise<void>;
}) {
  if (report.partners.length === 0)
    return <Hint>{webMessages.adminReferralsEmpty}</Hint>;
  return (
    <>
      <section aria-label={webMessages.adminReferralsTotalLabel}>
        <StatTiles
          items={[
            {
              key: "count",
              label: webMessages.adminReferralsTileCount,
              value: String(report.total.count),
              tone: "gray",
            },
            {
              key: "reward",
              label: webMessages.adminReferralsTileReward,
              value: formatYen(report.total.rewardAmount),
            },
            {
              key: "tax",
              label: webMessages.adminReferralsTileTax,
              value: formatYen(report.total.taxAmount),
            },
            {
              key: "payable",
              label: webMessages.adminReferralsTilePayable,
              value: formatYen(report.total.payableAmount),
            },
            {
              key: "paid",
              label: webMessages.adminReferralsTilePaid,
              value: formatYen(report.total.paidPayableAmount),
            },
            {
              key: "unpaid",
              label: webMessages.adminReferralsTileUnpaid,
              value: formatYen(report.total.unpaidPayableAmount),
            },
          ]}
        />
      </section>
      {report.partners.map((partner) => (
        <Block
          key={partner.partnerId}
          title={`${partner.partnerName}（${partner.referralCode}）`}
        >
          <Table
            caption={webMessages.adminReferralsTableCaption
              .replace("{partner}", partner.partnerName)
              .replace("{code}", partner.referralCode)}
            columns={[
              { key: "shop", header: webMessages.adminReferralsColShop },
              { key: "type", header: webMessages.adminReferralsColType },
              {
                key: "base",
                header: webMessages.adminReferralsColBase,
                numeric: true,
              },
              {
                key: "reward",
                header: webMessages.adminReferralsColReward,
                numeric: true,
              },
              {
                key: "tax",
                header: webMessages.adminReferralsColTax,
                numeric: true,
              },
              {
                key: "payable",
                header: webMessages.adminReferralsColPayable,
                numeric: true,
              },
              {
                key: "progress",
                header: webMessages.adminReferralsColProgress,
              },
              { key: "payment", header: webMessages.adminReferralsColPayment },
            ]}
            rows={[
              ...partner.rows.map((line) => ({
                shop: line.shopName,
                type: typeLabel(line),
                base: formatYen(line.baseAmount),
                reward: formatYen(line.rewardAmount),
                tax: formatYen(line.taxAmount),
                payable: formatYen(line.payableAmount),
                progress: webMessages.adminReferralsProgress
                  .replace("{index}", String(line.monthIndex))
                  .replace("{max}", String(line.maxMonths)),
                payment:
                  line.status === "paid" ? (
                    <>
                      <Badge tone="sage">
                        {webMessages.adminReferralsPaid}
                      </Badge>
                      {line.paidOn ? (
                        <span className="ui-table__sub">
                          {formatSlashDate(line.paidOn)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <Badge tone="gray">
                      {webMessages.adminReferralsUnpaid}
                    </Badge>
                  ),
              })),
              {
                shop: <b>{webMessages.adminReferralsSubtotal}</b>,
                type: "",
                base: <b>{formatYen(partner.subtotal.baseAmount)}</b>,
                reward: <b>{formatYen(partner.subtotal.rewardAmount)}</b>,
                tax: <b>{formatYen(partner.subtotal.taxAmount)}</b>,
                payable: <b>{formatYen(partner.subtotal.payableAmount)}</b>,
                progress: "",
                payment: (
                  <>
                    {webMessages.adminReferralsUnpaidSubtotal}:{" "}
                    {formatYen(partner.subtotal.unpaidPayableAmount)}
                  </>
                ),
              },
            ]}
          />
          {partner.subtotal.unpaidPayableAmount > 0 ? (
            <div>
              <Field label={webMessages.adminReferralsPaidOnLabel}>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(event) =>
                    setPaymentDate(event.currentTarget.value)
                  }
                />
              </Field>
              <Button
                disabled={paying !== null || !paymentDate}
                onClick={() =>
                  void onPay({
                    month: report.month,
                    partnerId: partner.partnerId,
                    paidOn: paymentDate,
                  })
                }
              >
                {paying === partner.partnerId
                  ? webMessages.adminReferralsPaying
                  : webMessages.adminReferralsPayAction}
              </Button>
            </div>
          ) : null}
        </Block>
      ))}
      <Hint>{webMessages.adminReferralsNote}</Hint>
    </>
  );
}
