import { webMessages } from "@kobito/shared";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  type AdminApiClient,
  AdminApiError,
} from "../platform/admin-api-client.js";

type Pending = Awaited<
  ReturnType<AdminApiClient["getPendingBankTransfers"]>
>["items"][number];
type Confirmed = Awaited<ReturnType<AdminApiClient["confirmBankPayment"]>>;

function yen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

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

  return (
    <main className="page-main admin-bank-transfer-page">
      <section
        className="card admin-card"
        aria-labelledby="bank-transfer-title"
      >
        <h1 id="bank-transfer-title">{webMessages.bankTransferTitle}</h1>
        <p>{webMessages.bankTransferIntro}</p>
        {result ? (
          <section className="bank-transfer-result" aria-live="polite">
            <h2>
              {result.payment.preview
                ? webMessages.bankTransferSuccessPreview
                : webMessages.bankTransferSuccess}
            </h2>
            <dl className="admin-detail-list">
              <dt>{webMessages.bankTransferCustomer}</dt>
              <dd>{result.item.customer.shopName}</dd>
              <dt>{webMessages.bankTransferInvoice}</dt>
              <dd>{result.item.invoice.invoiceNo}</dd>
              <dt>{webMessages.contractDate}</dt>
              <dd>{result.payment.anchorDate}</dd>
              <dt>{webMessages.contractPeriod}</dt>
              <dd>
                {result.payment.period.startsOn}〜{result.payment.period.endsOn}
              </dd>
              <dt>{webMessages.contractCredits}</dt>
              <dd>
                {result.payment.period.credits}{" "}
                {webMessages.contractBalanceUnit}
              </dd>
            </dl>
          </section>
        ) : null}
        {loading ? <output>{webMessages.bankTransferLoading}</output> : null}
        {loadError ? (
          <div>
            <p className="error-message" role="alert">
              {webMessages.bankTransferLoadError}
            </p>
            <button
              className="secondary-button"
              onClick={() => setRefresh((v) => v + 1)}
              type="button"
            >
              {webMessages.retry}
            </button>
          </div>
        ) : null}
        {pageError ? (
          <div>
            <p className="error-message" role="alert">
              {pageError}
            </p>
            <button
              className="secondary-button"
              onClick={() => setRefresh((value) => value + 1)}
              type="button"
            >
              {webMessages.retry}
            </button>
          </div>
        ) : null}
        {!loading && !loadError && items.length === 0 ? (
          <p>{webMessages.bankTransferEmpty}</p>
        ) : null}
        {items.length ? (
          <div className="bank-transfer-list">
            {items.map((item) =>
              (() => {
                const { invoice, customer } = item;
                return (
                  <article className="bank-transfer-item" key={invoice.id}>
                    <h2>{customer.shopName}</h2>
                    <dl className="admin-detail-list">
                      <dt>{webMessages.bankTransferCustomer}</dt>
                      <dd>{customer.billingName}</dd>
                      <dt>{webMessages.bankTransferInvoice}</dt>
                      <dd>
                        <Link
                          to={`/admin/invoices/${encodeURIComponent(invoice.id)}`}
                        >
                          {invoice.invoiceNo}
                        </Link>
                      </dd>
                      <dt>{webMessages.bankTransferAmount}</dt>
                      <dd>{yen(invoice.totalInclTax)}</dd>
                      <dt>{webMessages.bankTransferDue}</dt>
                      <dd>{invoice.dueOn}</dd>
                    </dl>
                    {invoice.preview ? (
                      <p className="invoice-preview-warning" role="note">
                        {webMessages.bankTransferPreviewWarning}
                      </p>
                    ) : null}
                    <button
                      className="primary-button"
                      disabled={Boolean(activeId) || confirming}
                      onClick={() => begin(item)}
                      type="button"
                    >
                      {webMessages.bankTransferConfirm}
                    </button>
                  </article>
                );
              })(),
            )}
          </div>
        ) : null}
        {active ? (
          <section
            className="bank-transfer-confirmation"
            aria-labelledby="bank-transfer-form-title"
          >
            <h2 id="bank-transfer-form-title">
              {webMessages.bankTransferConfirmTitle}
            </h2>
            <p>
              {active.customer.shopName} ／ {active.invoice.invoiceNo} ／{" "}
              {yen(active.invoice.totalInclTax)}
            </p>
            <label className="field-label" htmlFor="bank-transfer-amount">
              {webMessages.bankTransferAmount}
            </label>
            <input
              id="bank-transfer-amount"
              inputMode="numeric"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.currentTarget.value)}
              aria-invalid={amount.length > 0 && !amountValid}
            />
            {amount.length > 0 && !amountValid ? (
              <p className="error-message" role="alert">
                {webMessages.bankTransferAmountInvalid}
              </p>
            ) : null}
            <label className="field-label" htmlFor="bank-transfer-date">
              {webMessages.bankTransferDate}
            </label>
            <input
              id="bank-transfer-date"
              type="date"
              value={paidOn}
              onChange={(event) => setPaidOn(event.currentTarget.value)}
              min={active.invoice.issuedOn}
              max={active.invoice.dueOn}
              aria-invalid={paidOn.length > 0 && !dateValid}
            />
            {paidOn.length > 0 && !dateValid ? (
              <p className="error-message" role="alert">
                {webMessages.bankTransferDateInvalid}
              </p>
            ) : null}
            {active.invoice.preview ? (
              <label className="preview-acknowledgement">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) =>
                    setAcknowledged(event.currentTarget.checked)
                  }
                />{" "}
                {webMessages.bankTransferPreviewAck}
              </label>
            ) : null}
            {error ? (
              <p className="error-message" role="alert">
                {error}
              </p>
            ) : null}
            {reviewing ? (
              <section
                className="bank-transfer-final-check"
                aria-labelledby="bank-transfer-final-title"
              >
                <h3 id="bank-transfer-final-title">
                  {webMessages.bankTransferFinalTitle}
                </h3>
                <p>{webMessages.bankTransferAnchorNotice}</p>
                <p>
                  {active.customer.shopName} ／ {active.invoice.invoiceNo} ／{" "}
                  {yen(parsedAmount)} ／ {paidOn}
                </p>
                <div className="admin-actions">
                  <button
                    className="primary-button"
                    disabled={!canReview}
                    onClick={() => void submit()}
                    type="button"
                  >
                    {confirming
                      ? webMessages.bankTransferWorking
                      : webMessages.bankTransferConfirm}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={confirming}
                    onClick={() => setReviewing(false)}
                    type="button"
                  >
                    {webMessages.bankTransferCancel}
                  </button>
                </div>
              </section>
            ) : (
              <div className="admin-actions">
                <button
                  className="primary-button"
                  disabled={!canReview}
                  onClick={() => setReviewing(true)}
                  type="button"
                >
                  {webMessages.bankTransferReview}
                </button>
                <button
                  className="secondary-button"
                  disabled={confirming}
                  onClick={cancel}
                  type="button"
                >
                  {webMessages.bankTransferCancel}
                </button>
              </div>
            )}
          </section>
        ) : null}
      </section>
    </main>
  );
}
