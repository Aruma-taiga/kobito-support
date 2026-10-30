import {
  type InvoiceDetail,
  type InvoiceListItem,
  webMessages,
} from "@kobito/shared";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AdminApiClient } from "../platform/admin-api-client.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";

type InvoiceClient = Pick<
  AdminApiClient,
  "getInvoices" | "getInvoice" | "getInvoicePdf"
>;

function yen(value: number): string {
  return `￥${value.toLocaleString("ja-JP")}`;
}

function invoiceStatus(status: InvoiceListItem["status"]): string {
  const labels: Record<InvoiceListItem["status"], string> = {
    issued: webMessages.invoiceStatusIssued,
    paid: webMessages.invoiceStatusPaid,
    failed: webMessages.invoiceStatusFailed,
    overdue: webMessages.invoiceStatusOverdue,
    void: webMessages.invoiceStatusVoid,
  };
  return labels[status];
}

function safeFilename(invoiceNo: string): string {
  return invoiceNo.replace(/[^\p{L}\p{N}._-]/gu, "_");
}

function InvoiceListPage({
  client,
  basePath,
  returnLabel,
}: {
  client: InvoiceClient;
  basePath: string;
  returnLabel: string;
}) {
  const [items, setItems] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Retry count is an intentional refetch trigger even though the request URL is unchanged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry state must trigger another fetch
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void client
      .getInvoices()
      .then(({ invoices }) => {
        if (active) setItems(invoices);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, client]);

  return (
    <main className="page-main">
      <section
        className="card invoice-card"
        aria-labelledby="invoice-list-title"
      >
        <Link
          className="admin-back-link"
          to={
            returnLabel === webMessages.adminQueueTitle
              ? "/admin/customers"
              : "/me"
          }
        >
          {returnLabel}
        </Link>
        <h1 id="invoice-list-title">{webMessages.invoiceListTitle}</h1>
        {loading ? (
          <output className="status-message">
            {webMessages.invoiceListLoading}
          </output>
        ) : null}
        {error ? (
          <div>
            <p className="error-message" role="alert">
              {webMessages.invoiceListError}
            </p>
            <button
              className="secondary-button"
              onClick={() => setAttempt((value) => value + 1)}
              type="button"
            >
              {webMessages.invoiceRetry}
            </button>
          </div>
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <p className="muted-text">{webMessages.invoiceListEmpty}</p>
        ) : null}
        {!loading && !error && items.length > 0 ? (
          <ul className="invoice-list">
            {items.map((item) => (
              <li key={item.id}>
                <Link to={`${basePath}/${encodeURIComponent(item.id)}`}>
                  <strong>{item.invoiceNo}</strong>
                  <span>
                    {item.issuedOn} · {yen(item.totalInclTax)} ·{" "}
                    {invoiceStatus(item.status)}
                  </span>
                  {item.preview ? (
                    <span className="invoice-preview-label">
                      {webMessages.invoicePreviewShort}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}

function InvoiceDetailPage({
  client,
  listPath,
  returnLabel,
}: {
  client: InvoiceClient;
  listPath: string;
  returnLabel: string;
}) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  // Retry count is an intentional refetch trigger even though the request URL is unchanged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry state must trigger another fetch
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void client
      .getInvoice(id)
      .then((detail) => {
        if (active) setInvoice(detail);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, client, id]);

  async function downloadPdf() {
    if (!invoice || downloading) return;
    setDownloading(true);
    setDownloadError(false);
    let objectUrl: string | null = null;
    try {
      const blob = await client.getInvoicePdf(invoice.id);
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${safeFilename(invoice.invoiceNo)}.pdf`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
      const createdUrl = objectUrl;
      if (createdUrl) {
        window.setTimeout(() => URL.revokeObjectURL(createdUrl), 0);
      }
    }
  }

  return (
    <main className="page-main">
      <section
        className="card invoice-card"
        aria-labelledby="invoice-detail-title"
      >
        <Link className="admin-back-link" to={listPath}>
          {returnLabel}
        </Link>
        {loading ? (
          <output className="status-message">
            {webMessages.invoiceListLoading}
          </output>
        ) : null}
        {error ? (
          <div>
            <p className="error-message" role="alert">
              {webMessages.invoiceDetailError}
            </p>
            <button
              className="secondary-button"
              onClick={() => setAttempt((value) => value + 1)}
              type="button"
            >
              {webMessages.invoiceRetry}
            </button>
          </div>
        ) : null}
        {!loading && !error && invoice ? (
          <>
            <h1 id="invoice-detail-title">{webMessages.invoiceDetailTitle}</h1>
            {invoice.preview ? (
              <p className="invoice-preview-warning" role="note">
                {webMessages.invoicePreviewWarning}
              </p>
            ) : null}
            <h2 className="invoice-number">{invoice.invoiceNo}</h2>
            <dl className="invoice-data">
              <dt>{webMessages.invoiceStatusLabel}</dt>
              <dd>{invoiceStatus(invoice.status)}</dd>
              <dt>{webMessages.invoiceIssuedOn}</dt>
              <dd>{invoice.issuedOn}</dd>
              <dt>{webMessages.invoiceDueOn}</dt>
              <dd>{invoice.dueOn}</dd>
              <dt>{webMessages.invoiceBillingName}</dt>
              <dd>{invoice.billingName}</dd>
              <dt>{webMessages.invoiceBillingAddress}</dt>
              <dd>{invoice.billingAddress}</dd>
            </dl>
            <h2>{webMessages.invoiceAcceptedPlan}</h2>
            <dl className="invoice-data">
              <dt>{webMessages.invoiceAcceptedPlan}</dt>
              <dd>{invoice.acceptedPlan.planName}</dd>
              <dt>{webMessages.invoiceAcceptedMonthlyPrice}</dt>
              <dd>{yen(invoice.acceptedPlan.monthlyPriceInclTax)}</dd>
              <dt>{webMessages.invoiceAcceptedCredits}</dt>
              <dd>{invoice.acceptedPlan.credits}</dd>
            </dl>
            <h2>{webMessages.invoiceIssuerHeading}</h2>
            <dl className="invoice-data">
              <dt>{webMessages.invoiceServiceName}</dt>
              <dd>{invoice.issuer.serviceName}</dd>
              <dt>{webMessages.invoiceCompanyName}</dt>
              <dd>{invoice.issuer.companyName}</dd>
              <dt>{webMessages.invoiceCompanyAddress}</dt>
              <dd>{invoice.issuer.companyAddress}</dd>
              <dt>{webMessages.applicationInvoiceRegistrationNo}</dt>
              <dd>
                {invoice.issuer.invoiceRegistrationNo ??
                  webMessages.invoiceNotSet}
              </dd>
            </dl>
            <h2>{webMessages.invoiceLinesHeading}</h2>
            <div className="invoice-table-wrap">
              <table className="invoice-lines">
                <thead>
                  <tr>
                    <th>{webMessages.invoiceLineDescription}</th>
                    <th>{webMessages.invoiceLineQuantity}</th>
                    <th>{webMessages.invoiceLineUnitPrice}</th>
                    <th>{webMessages.invoiceLineAmount}</th>
                    <th>{webMessages.invoiceTaxRate}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line, index) => (
                    <tr key={`${line.description}-${index}`}>
                      <td>{line.description}</td>
                      <td>{line.quantity}</td>
                      <td>{yen(line.unitPriceInclTax)}</td>
                      <td>{yen(line.amountInclTax)}</td>
                      <td>{Math.round(line.taxRate * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="invoice-totals">
              <dt>{webMessages.invoiceTotalExclTax}</dt>
              <dd>{yen(invoice.totalExclTax)}</dd>
              <dt>{webMessages.invoiceTaxAmount}</dt>
              <dd>{yen(invoice.taxAmount)}</dd>
              <dt>{webMessages.invoiceTotalInclTax}</dt>
              <dd>
                <strong>{yen(invoice.totalInclTax)}</strong>
              </dd>
            </dl>
            <h2>{webMessages.invoiceBankHeading}</h2>
            {invoice.paymentMethod === "bank_transfer" ? (
              <dl className="invoice-data">
                <dt>{webMessages.invoiceBankName}</dt>
                <dd>
                  {invoice.issuer.bankAccountName ?? webMessages.invoiceNotSet}
                </dd>
                <dt>{webMessages.invoiceBankBranch}</dt>
                <dd>
                  {invoice.issuer.bankAccountBranch ??
                    webMessages.invoiceNotSet}
                </dd>
                <dt>{webMessages.invoiceBankAccountType}</dt>
                <dd>
                  {invoice.issuer.bankAccountType ?? webMessages.invoiceNotSet}
                </dd>
                <dt>{webMessages.invoiceBankAccountNumber}</dt>
                <dd>
                  {invoice.issuer.bankAccountNumber ??
                    webMessages.invoiceNotSet}
                </dd>
              </dl>
            ) : (
              <p>{webMessages.invoiceBankInPdf}</p>
            )}
            {downloadError ? (
              <p className="error-message" role="alert">
                {webMessages.invoiceDownloadError}
              </p>
            ) : null}
            <button
              className="primary-button"
              disabled={downloading}
              onClick={() => void downloadPdf()}
              type="button"
            >
              {downloading
                ? webMessages.invoiceDownloadWorking
                : webMessages.invoiceDownload}
            </button>
            <button
              className="secondary-button invoice-back-button"
              onClick={() => navigate(listPath)}
              type="button"
            >
              {returnLabel}
            </button>
          </>
        ) : null}
      </section>
    </main>
  );
}

export function AdminInvoiceListPage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  return (
    <InvoiceListPage
      client={apiClient}
      basePath="/admin/invoices"
      returnLabel={webMessages.adminQueueTitle}
    />
  );
}

export function AdminInvoiceDetailPage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  return (
    <InvoiceDetailPage
      client={apiClient}
      listPath="/admin/invoices"
      returnLabel={webMessages.invoiceListTitle}
    />
  );
}

export function MyInvoiceListPage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  return (
    <InvoiceListPage
      client={apiClient}
      basePath="/me/invoices"
      returnLabel={webMessages.homeTitle}
    />
  );
}

export function MyInvoiceDetailPage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  return (
    <InvoiceDetailPage
      client={apiClient}
      listPath="/me/invoices"
      returnLabel={webMessages.invoiceListTitle}
    />
  );
}
