import {
  type AdminApplicationQueueItem,
  type AdminRequestSummary,
  daysUntil,
  type InvoiceListItem,
  isDueSoon,
  type PendingBankTransfers,
  webMessages,
} from "@kobito/shared";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AdminApiClient } from "../platform/admin-api-client.js";
import { formatSlashDate, tokyoDateOf } from "../platform/format.js";
import {
  AdminColumns,
  AdminHeading,
  Badge,
  type BadgeTone,
  Button,
  buttonClass,
  Card,
  Hint,
  ListItem,
} from "../ui/index.js";
import { formatExclIncl, formatPaymentMethod } from "./admin-format.js";

/** 一覧に出す行数。これを超えた分は件数だけ知らせ、一覧の画面へ誘導する。 */
const visibleRows = 5;
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

type Source<T> =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; value: T };

function useSource<T>(load: () => Promise<T>): [Source<T>, () => void] {
  const [state, setState] = useState<Source<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // load は呼び出し側で安定させる（apiClient が変わったときだけ変わる）
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally retries the fetch
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    load().then(
      (value) => {
        if (current) setState({ status: "ready", value });
      },
      () => {
        if (current) setState({ status: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [load, attempt]);
  return [state, () => setAttempt((value) => value + 1)];
}

function todayLabel(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  if (!year || !month || !day) return today;
  const weekday =
    weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}月${day}日（${weekday}）`;
}

function dueText(dueOn: string, today: string): string {
  const days = daysUntil(dueOn, today);
  const date = formatSlashDate(dueOn);
  if (days > 0)
    return webMessages.adminTodayDueIn
      .replace("{date}", date)
      .replace("{days}", String(days));
  if (days === 0) return webMessages.adminTodayDueToday.replace("{date}", date);
  return webMessages.adminTodayOverdue
    .replace("{date}", date)
    .replace("{days}", String(-days));
}

interface Row {
  key: string;
  title: ReactNode;
  meta: ReactNode;
  to: string;
  action: string;
  badge?: ReactNode;
  primary?: boolean;
}

function Panel({
  title,
  source,
  retry,
  rows,
  note,
  tone = "yellow",
  moreTo,
}: {
  title: string;
  source: Source<unknown>;
  retry: () => void;
  rows: Row[];
  note?: string;
  tone?: BadgeTone;
  moreTo?: string;
}) {
  const count =
    source.status === "ready" ? (
      <Badge tone={rows.length === 0 ? "gray" : tone}>{rows.length}</Badge>
    ) : null;
  return (
    <Card title={title} action={count}>
      {note ? <Hint>{note}</Hint> : null}
      {source.status === "loading" ? (
        <output className="ui-hint">{webMessages.adminTodayLoading}</output>
      ) : null}
      {source.status === "error" ? (
        <>
          <Hint>{webMessages.adminTodayPanelError}</Hint>
          <Button variant="ghost" size="sm" onClick={retry}>
            {webMessages.adminTodayRetry}
          </Button>
        </>
      ) : null}
      {source.status === "ready" && rows.length === 0 ? (
        <Hint>{webMessages.adminTodayEmpty}</Hint>
      ) : null}
      {source.status === "ready"
        ? rows.slice(0, visibleRows).map((row) => (
            <ListItem
              key={row.key}
              title={row.title}
              meta={row.meta}
              badge={
                <span className="ui-actionbar">
                  {row.badge}
                  <Link
                    className={buttonClass(row.primary ? "primary" : "ghost", {
                      size: "sm",
                    })}
                    to={row.to}
                  >
                    {row.action}
                  </Link>
                </span>
              }
            />
          ))
        : null}
      {source.status === "ready" && rows.length > visibleRows && moreTo ? (
        <Hint>
          <Link to={moreTo}>
            {webMessages.adminTodayMore.replace(
              "{count}",
              String(rows.length - visibleRows),
            )}
          </Link>
        </Hint>
      ) : null}
    </Card>
  );
}

const customerLink = (id: string) =>
  `/admin/customers/${encodeURIComponent(id)}`;

/** a02 今日やること。既存の管理APIの結果から、やることを件数と短い一覧にする。 */
export function AdminTodayPage({ apiClient }: { apiClient: AdminApiClient }) {
  const today = tokyoDateOf(new Date().toISOString());
  const [reviewing, retryReviewing] = useSource(
    useCallback(
      () =>
        apiClient.getApplications({ status: "under_review", pageSize: 100 }),
      [apiClient],
    ),
  );
  const [quoting, retryQuoting] = useSource(
    useCallback(
      () => apiClient.getApplications({ status: "quoting", pageSize: 100 }),
      [apiClient],
    ),
  );
  const [transfers, retryTransfers] = useSource<PendingBankTransfers>(
    useCallback(() => apiClient.getPendingBankTransfers(), [apiClient]),
  );
  const [invoices, retryInvoices] = useSource(
    useCallback(() => apiClient.getInvoices(), [apiClient]),
  );
  const [requests, retryRequests] = useSource(
    useCallback(() => apiClient.getAdminRequests(), [apiClient]),
  );
  const [contracts] = useSource(
    useCallback(() => apiClient.getRequestContracts(), [apiClient]),
  );

  const shopByInvoice = new Map<string, string>();
  if (transfers.status === "ready")
    for (const item of transfers.value.items)
      shopByInvoice.set(item.invoice.id, item.customer.shopName);
  const shopByContract = new Map<string, string>();
  if (contracts.status === "ready")
    for (const item of contracts.value.items)
      shopByContract.set(item.contractId, item.shopName);

  const applicationRow =
    (action: string, to: (item: AdminApplicationQueueItem) => string) =>
    (item: AdminApplicationQueueItem): Row => ({
      key: item.customerId,
      title: item.shopName,
      meta: [
        webMessages.adminTodayReceived.replace(
          "{date}",
          formatSlashDate(tokyoDateOf(item.submittedAt)),
        ),
        item.planName,
        formatPaymentMethod(item.paymentMethod),
      ]
        .filter(Boolean)
        .join("・"),
      to: to(item),
      action,
    });

  const reviewRows =
    reviewing.status === "ready"
      ? reviewing.value.items
          .map(
            applicationRow(webMessages.adminTodayReviewAction, (item) =>
              customerLink(item.customerId),
            ),
          )
          .map((row) => ({ ...row, primary: true }))
      : [];
  const quoteRows =
    quoting.status === "ready"
      ? quoting.value.items.map(
          (item): Row => ({
            key: item.customerId,
            title: item.shopName,
            meta: webMessages.adminTodayQuoteMeta.replace(
              "{date}",
              formatSlashDate(tokyoDateOf(item.submittedAt)),
            ),
            to: `${customerLink(item.customerId)}/plan-quote`,
            action: webMessages.adminTodayQuoteAction,
          }),
        )
      : [];
  const bankRows =
    transfers.status === "ready"
      ? [...transfers.value.items]
          .sort((a, b) => a.invoice.dueOn.localeCompare(b.invoice.dueOn))
          .map(
            (item): Row => ({
              key: item.invoice.id,
              title: item.customer.shopName,
              meta: `${item.invoice.invoiceNo}・${formatExclIncl(item.invoice.totalExclTax)}・${dueText(item.invoice.dueOn, today)}`,
              to: "/admin/bank-transfers",
              action: webMessages.adminTodayBankAction,
            }),
          )
      : [];
  const dueSoonRows =
    invoices.status === "ready"
      ? invoices.value.invoices
          .filter(
            (invoice: InvoiceListItem) =>
              ["issued", "overdue", "failed"].includes(invoice.status) &&
              isDueSoon(invoice.dueOn, today),
          )
          .sort((a, b) => a.dueOn.localeCompare(b.dueOn))
          .map(
            (invoice): Row => ({
              key: invoice.id,
              title: shopByInvoice.get(invoice.id) ?? invoice.invoiceNo,
              meta: `${invoice.invoiceNo}・${formatExclIncl(invoice.totalExclTax)}・${dueText(invoice.dueOn, today)}`,
              to: `/admin/invoices/${encodeURIComponent(invoice.id)}`,
              action: webMessages.adminTodayDueSoonAction,
              badge:
                daysUntil(invoice.dueOn, today) < 0 ? (
                  <Badge tone="warn">{webMessages.invoiceStatusOverdue}</Badge>
                ) : undefined,
            }),
          )
      : [];

  const requestRow =
    (action: string, extra: (request: AdminRequestSummary) => string) =>
    (request: AdminRequestSummary): Row => ({
      key: request.id,
      title: shopByContract.get(request.contractId) ?? request.summary,
      meta: [
        shopByContract.has(request.contractId) ? request.summary : null,
        extra(request),
      ]
        .filter(Boolean)
        .join("・"),
      to: `/admin/requests/${encodeURIComponent(request.id)}`,
      action,
      badge: request.urgent ? (
        <Badge tone="warn">{webMessages.adminTodayUrgent}</Badge>
      ) : undefined,
    });
  const estimateRows =
    requests.status === "ready"
      ? requests.value.items
          .filter((request) => request.status === "received")
          .map(
            requestRow(webMessages.adminTodayRequestEstimateAction, (request) =>
              webMessages.adminTodayReceived.replace(
                "{date}",
                formatSlashDate(request.receivedOn),
              ),
            ),
          )
      : [];
  const startRows =
    requests.status === "ready"
      ? requests.value.items
          .filter((request) => request.status === "in_progress")
          .map(
            requestRow(webMessages.adminTodayRequestStartAction, (request) =>
              request.latestEstimate
                ? `${request.latestEstimate.credits}クレジット・目安 ${formatSlashDate(request.latestEstimate.dueOn)}`
                : "",
            ),
          )
      : [];

  return (
    <>
      <AdminHeading
        id="admin-today-title"
        crumb={todayLabel(today)}
        title={webMessages.adminTodayTitle}
      />
      <AdminColumns>
        <div>
          <Panel
            title={webMessages.adminTodayReview}
            source={reviewing}
            retry={retryReviewing}
            rows={reviewRows}
            moreTo="/admin/customers"
          />
          <Panel
            title={webMessages.adminTodayQuote}
            source={quoting}
            retry={retryQuoting}
            rows={quoteRows}
            moreTo="/admin/customers"
          />
          <Panel
            title={webMessages.adminTodayBank}
            source={transfers}
            retry={retryTransfers}
            rows={bankRows}
            moreTo="/admin/bank-transfers"
          />
        </div>
        <div>
          <Panel
            title={webMessages.adminTodayDueSoon}
            source={invoices}
            retry={retryInvoices}
            rows={dueSoonRows}
            note={webMessages.adminTodayDueSoonNote}
            tone="warn"
            moreTo="/admin/invoices"
          />
          <Panel
            title={webMessages.adminTodayRequestEstimate}
            source={requests}
            retry={retryRequests}
            rows={estimateRows}
            tone="gray"
            moreTo="/admin/requests"
          />
          <Panel
            title={webMessages.adminTodayRequestStart}
            source={requests}
            retry={retryRequests}
            rows={startRows}
            tone="sage"
            moreTo="/admin/requests"
          />
        </div>
      </AdminColumns>
    </>
  );
}
