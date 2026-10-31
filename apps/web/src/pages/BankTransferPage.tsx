import { webMessages } from "@kobito/shared";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  type AdminApiClient,
  AdminApiError,
} from "../platform/admin-api-client.js";
import { formatSlashDate, formatYen } from "../platform/format.js";
import {
  ActionBar,
  AdminHeading,
  Badge,
  Button,
  Card,
  DefinitionList,
  Field,
  Hint,
  Notice,
  Table,
} from "../ui/index.js";

type Pending = Awaited<
  ReturnType<AdminApiClient["getPendingBankTransfers"]>
>["items"][number];
type Confirmed = Awaited<ReturnType<AdminApiClient["confirmBankPayment"]>>;

function isAllowedDate(value: string, invoice: Pending["invoice"]): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  const today = new Date();
  const todayJst = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
  }).format(today);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value &&
    value >= invoice.issuedOn &&
    value <= invoice.dueOn &&
    value <= todayJst
  );
}

export function AdminBankTransferPage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  const [items, setItems] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const submitting = useRef(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    item: Pending;
    payment: Confirmed;
  } | null>(null);

  useEffect(() => {
    const refreshKey = refresh.toString();
    void refreshKey;
    let current = true;
    setLoading(true);
    setLoadError(false);
    void apiClient
      .getPendingBankTransfers()
      .then((response) => {
        if (current) setItems(response.items);
      })
      .catch(() => {
        if (current) setLoadError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [apiClient, refresh]);

  const active = items.find((item) => item.invoice.id === activeId) ?? null;
  const parsedAmount = /^\d+$/.test(amount) ? Number(amount) : NaN;
  const amountValid =
    Boolean(active) &&
    Number.isSafeInteger(parsedAmount) &&
    parsedAmount > 0 &&
    parsedAmount === active?.invoice.totalInclTax;
  const dateValid = Boolean(active && isAllowedDate(paidOn, active.invoice));
  const canReview = Boolean(
    active &&
      amountValid &&
      dateValid &&
      (!active.invoice.preview || acknowledged) &&
      !confirming,
  );

  function begin(item: Pending) {
    setActiveId(item.invoice.id);
    setAmount("");
    setPaidOn("");
    setAcknowledged(false);
    setError(null);
    setPageError(null);
    setResult(null);
    setReviewing(false);
  }

  function cancel() {
    if (confirming) return;
    setActiveId(null);
    setError(null);
    setReviewing(false);
  }

  async function submit() {
    if (!active || !canReview || submitting.current) return;
    submitting.current = true;
    setConfirming(true);
    setError(null);
    try {
      const payment = await apiClient.confirmBankPayment(active.invoice.id, {
        amount: parsedAmount,
        paidOn,
        ...(active.invoice.preview
          ? { previewAcknowledged: acknowledged }
          : {}),
      });
      setResult({ item: active, payment });
      setActiveId(null);
      setRefresh((value) => value + 1);
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.code === "conflict") {
        setActiveId(null);
        setPageError(webMessages.bankTransferConflict);
        setRefresh((value) => value + 1);
      } else {
        setError(webMessages.bankTransferError);
      }
    } finally {
      submitting.current = false;
      setConfirming(false);
    }
  }

  const amountError =
    amount.length > 0 && !amountValid
      ? webMessages.bankTransferAmountInvalid
      : undefined;
  const dateError =
    paidOn.length > 0 && !dateValid
      ? webMessages.bankTransferDateInvalid
      : undefined;
  return (
    <>
      <AdminHeading
        id="bank-transfer-title"
        title={webMessages.bankTransferTitle}
      />
      <p className="ui-admin__lead">{webMessages.bankTransferIntro}</p>
      {result ? (
        <Notice
          live
          title={
            result.payment.preview
              ? webMessages.bankTransferSuccessPreview
              : webMessages.bankTransferSuccess
          }
        >
          <DefinitionList
            items={[
              {
                term: webMessages.bankTransferCustomer,
                description: result.item.customer.shopName,
              },
              {
                term: webMessages.bankTransferInvoice,
                description: result.item.invoice.invoiceNo,
              },
              {
                term: webMessages.contractDate,
                description: result.payment.anchorDate,
              },
              {
                term: webMessages.contractPeriod,
                description: `${result.payment.period.startsOn}〜${result.payment.period.endsOn}`,
              },
              {
                term: webMessages.contractCredits,
                description: `${result.payment.period.credits} ${webMessages.contractBalanceUnit}`,
              },
            ]}
          />
        </Notice>
      ) : null}
      {loading ? (
        <output className="ui-admin__lead">
          {webMessages.bankTransferLoading}
        </output>
      ) : null}
      {loadError ? (
        <>
          <Notice tone="warn">{webMessages.bankTransferLoadError}</Notice>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRefresh((v) => v + 1)}
          >
            {webMessages.retry}
          </Button>
        </>
      ) : null}
      {pageError ? (
        <>
          <Notice tone="warn">{pageError}</Notice>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRefresh((value) => value + 1)}
          >
            {webMessages.retry}
          </Button>
        </>
      ) : null}
      {!loading && !loadError && items.length === 0 ? (
        <Hint>{webMessages.bankTransferEmpty}</Hint>
      ) : null}
      {items.length ? (
        <Table
          caption={webMessages.bankTransferTableLabel}
          highlightRows={items.flatMap((item, index) =>
            item.invoice.id === activeId ? [index] : [],
          )}
          columns={[
            { key: "invoice", header: webMessages.bankTransferColInvoice },
            { key: "shop", header: webMessages.bankTransferColShop },
            { key: "amount", header: webMessages.bankTransferColAmount },
            { key: "due", header: webMessages.bankTransferColDue },
            { key: "action", header: "" },
          ]}
          rows={items.map((item) => {
            const { invoice, customer } = item;
            return {
              invoice: (
                <>
                  <Link
                    to={`/admin/invoices/${encodeURIComponent(invoice.id)}`}
                  >
                    {invoice.invoiceNo}
                  </Link>
                  {invoice.preview ? (
                    <span className="ui-table__sub">
                      {webMessages.bankTransferPreviewWarning}
                    </span>
                  ) : null}
                </>
              ),
              shop: (
                <>
                  <b>{customer.shopName}</b>
                  <span className="ui-table__sub">{customer.billingName}</span>
                </>
              ),
              amount: (
                <>
                  <span className="ui-table__sub">
                    {webMessages.adminSubtotalExcl}{" "}
                    {formatYen(invoice.totalExclTax)}
                  </span>
                  <span className="ui-table__sub">
                    {webMessages.adminTaxAmount} {formatYen(invoice.taxAmount)}
                  </span>
                  <b>
                    {webMessages.adminTotalIncl}{" "}
                    {formatYen(invoice.totalInclTax)}
                  </b>
                </>
              ),
              due: formatSlashDate(invoice.dueOn),
              action:
                invoice.id === activeId ? (
                  <Badge tone="yellow">
                    {webMessages.bankTransferEntering}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    disabled={Boolean(activeId) || confirming}
                    onClick={() => begin(item)}
                  >
                    {webMessages.bankTransferRowAction}
                  </Button>
                ),
            };
          })}
        />
      ) : null}
      {active ? (
        <Card title={webMessages.bankTransferConfirmTitle}>
          <p>
            {active.customer.shopName} ／ {active.invoice.invoiceNo} ／{" "}
            {webMessages.adminTotalIncl}{" "}
            {formatYen(active.invoice.totalInclTax)}
          </p>
          <Field
            label={webMessages.bankTransferAmount}
            hint={webMessages.bankTransferAmountHint.replace(
              "{total}",
              active.invoice.totalInclTax.toLocaleString("ja-JP"),
            )}
            error={amountError}
          >
            <input
              inputMode="numeric"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.currentTarget.value)}
            />
          </Field>
          <Field label={webMessages.bankTransferDate} error={dateError}>
            <input
              type="date"
              value={paidOn}
              onChange={(event) => setPaidOn(event.currentTarget.value)}
              min={active.invoice.issuedOn}
              max={active.invoice.dueOn}
            />
          </Field>
          {active.invoice.preview ? (
            <label className="ui-check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) =>
                  setAcknowledged(event.currentTarget.checked)
                }
              />
              <span>{webMessages.bankTransferPreviewAck}</span>
            </label>
          ) : null}
          {error ? <Notice tone="warn">{error}</Notice> : null}
          {reviewing ? (
            <section aria-labelledby="bank-transfer-final-title">
              <h4 className="ui-card__subtitle" id="bank-transfer-final-title">
                {webMessages.bankTransferFinalTitle}
              </h4>
              <Hint>{webMessages.bankTransferAnchorNotice}</Hint>
              <p>
                {active.customer.shopName} ／ {active.invoice.invoiceNo} ／{" "}
                {formatYen(parsedAmount)} ／ {paidOn}
              </p>
              <ActionBar>
                <Button
                  size="sm"
                  disabled={!canReview}
                  onClick={() => void submit()}
                >
                  {confirming
                    ? webMessages.bankTransferWorking
                    : webMessages.bankTransferConfirm}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={confirming}
                  onClick={() => setReviewing(false)}
                >
                  {webMessages.bankTransferCancel}
                </Button>
              </ActionBar>
            </section>
          ) : (
            <ActionBar>
              <Button
                size="sm"
                disabled={!canReview}
                onClick={() => setReviewing(true)}
              >
                {webMessages.bankTransferReview}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={confirming}
                onClick={cancel}
              >
                {webMessages.bankTransferCancel}
              </Button>
            </ActionBar>
          )}
        </Card>
      ) : null}
    </>
  );
}
