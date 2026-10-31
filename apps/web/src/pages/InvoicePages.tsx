import {
  type InvoiceDetail,
  type InvoiceListItem,
  webMessages,
} from "@kobito/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AdminApiClient } from "../platform/admin-api-client.js";
import { formatDate, formatSlashDate, formatYen } from "../platform/format.js";
import {
  AdminColumns,
  AdminHeading,
  AmountRows,
  Badge,
  type BadgeTone,
  Button,
  buttonClass,
  Card,
  DefinitionList,
  FilterChips,
  Hint,
  Notice,
  Table,
} from "../ui/index.js";
import { invoiceStatus } from "./invoice-format.js";
import { useInvoicePdfDownload } from "./invoice-pdf.js";

type InvoiceFilter = "all" | "unpaid" | "paid" | "failed" | "void";

const filterOptions: Array<{ value: InvoiceFilter; label: string }> = [
  { value: "all", label: webMessages.adminFilterAll },
  { value: "unpaid", label: webMessages.adminInvoiceFilterUnpaid },
  { value: "paid", label: webMessages.adminInvoiceFilterPaid },
  { value: "failed", label: webMessages.adminInvoiceFilterFailed },
  { value: "void", label: webMessages.adminInvoiceFilterVoid },
];

function matchesFilter(
  status: InvoiceListItem["status"],
  filter: InvoiceFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "unpaid") return status === "issued" || status === "overdue";
  return status === filter;
}

function statusTone(status: InvoiceListItem["status"]): BadgeTone {
  if (status === "paid") return "sage";
  if (status === "failed") return "warn";
  if (status === "issued" || status === "overdue") return "yellow";
  return "gray";
}

function paymentMethodLabel(method: InvoiceListItem["paymentMethod"]): string {
  if (method === "bank_transfer") return webMessages.applicationBankTransfer;
  if (method === "card") return webMessages.applicationCardPayment;
  return "—";
}

export function AdminInvoiceListPage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  const [items, setItems] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<InvoiceFilter>("all");

  // Retry count is an intentional refetch trigger even though the request URL is unchanged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry state must trigger another fetch
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void apiClient
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
  }, [attempt, apiClient]);

  const shown = items.filter((item) => matchesFilter(item.status, filter));
  return (
    <>
      <AdminHeading
        id="invoice-list-title"
        title={webMessages.adminInvoicesTitle}
      />
      <FilterChips
        label={webMessages.adminStatusFilterLabel}
        options={filterOptions}
        value={filter}
        onChange={(value) => setFilter(value)}
      />
      {loading ? (
        <output className="ui-admin__lead">
          {webMessages.invoiceListLoading}
        </output>
      ) : null}
      {error ? (
        <>
          <Notice tone="warn">{webMessages.invoiceListError}</Notice>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {webMessages.invoiceRetry}
          </Button>
        </>
      ) : null}
      {!loading && !error && shown.length === 0 ? (
        <Hint>{webMessages.invoiceListEmpty}</Hint>
      ) : null}
      {!loading && !error && shown.length > 0 ? (
        <Table
          caption={webMessages.adminInvoicesTableLabel}
          columns={[
            { key: "no", header: webMessages.adminInvoiceColNo },
            { key: "issued", header: webMessages.adminInvoiceColIssued },
            {
              key: "total",
              header: webMessages.adminInvoiceColTotal,
              numeric: true,
            },
            { key: "method", header: webMessages.adminInvoiceColMethod },
            { key: "status", header: webMessages.adminInvoiceColStatus },
            { key: "action", header: "" },
          ]}
          rows={shown.map((item) => ({
            no: (
              <>
                <Link to={`/admin/invoices/${encodeURIComponent(item.id)}`}>
                  {item.invoiceNo}
                </Link>
                {item.preview ? (
                  <span className="ui-table__sub">
                    {webMessages.invoicePreviewShort}
                  </span>
                ) : null}
              </>
            ),
            issued: formatSlashDate(item.issuedOn),
            total: (
              <>
                {formatYen(item.totalInclTax)}
                <span className="ui-table__sub">
                  {webMessages.adminInvoiceBreakdown
                    .replace("{excl}", formatYen(item.totalExclTax))
                    .replace("{tax}", formatYen(item.taxAmount))}
                </span>
              </>
            ),
            method: paymentMethodLabel(item.paymentMethod),
            status: (
              <Badge tone={statusTone(item.status)}>
                {invoiceStatus(item.status)}
              </Badge>
            ),
            action: (
              <Link
                className={buttonClass("ghost", { size: "sm" })}
                to={`/admin/invoices/${encodeURIComponent(item.id)}`}
              >
                {webMessages.adminInvoiceOpen}
              </Link>
            ),
          }))}
        />
      ) : null}
      <Hint>{webMessages.adminInvoiceNote}</Hint>
    </>
  );
}

export function AdminInvoiceDetailPage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  const { id = "" } = useParams();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Retry count is an intentional refetch trigger even though the request URL is unchanged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry state must trigger another fetch
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void apiClient
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
  }, [attempt, apiClient, id]);

  const { downloading, downloadError, downloadPdf } = useInvoicePdfDownload(
    apiClient,
    invoice,
  );

  const crumb = (
    <>
      <Link to="/admin/invoices">{webMessages.adminInvoicesTitle}</Link> ›
    </>
  );
  if (loading) {
    return (
      <output className="ui-admin__lead">
        {webMessages.invoiceListLoading}
      </output>
    );
  }
  if (error || !invoice) {
    return (
      <>
        <AdminHeading crumb={crumb} title={webMessages.invoiceDetailTitle} />
        <Notice tone="warn">{webMessages.invoiceDetailError}</Notice>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAttempt((value) => value + 1)}
        >
          {webMessages.invoiceRetry}
        </Button>
      </>
    );
  }
  const notSet = webMessages.invoiceNotSet;
  return (
    <>
      <AdminHeading
        id="invoice-detail-title"
        crumb={crumb}
        title={invoice.invoiceNo}
        badge={
          <Badge tone={statusTone(invoice.status)}>
            {invoiceStatus(invoice.status)}
          </Badge>
        }
        actions={
          <Button
            size="sm"
            disabled={downloading}
            onClick={() => void downloadPdf()}
          >
            {downloading
              ? webMessages.invoiceDownloadWorking
              : webMessages.invoiceDownload}
          </Button>
        }
      />
      {invoice.preview ? (
        <Notice tone="yellow">{webMessages.invoicePreviewWarning}</Notice>
      ) : null}
      {downloadError ? (
        <Notice tone="warn">{webMessages.invoiceDownloadError}</Notice>
      ) : null}
      <AdminColumns>
        <div>
          <Card title={webMessages.invoiceLinesHeading}>
            <Table
              caption={webMessages.invoiceLinesHeading}
              columns={[
                {
                  key: "description",
                  header: webMessages.invoiceLineDescription,
                },
                {
                  key: "quantity",
                  header: webMessages.invoiceLineQuantity,
                  numeric: true,
                },
                {
                  key: "unit",
                  header: webMessages.invoiceLineUnitPrice,
                  numeric: true,
                },
                {
                  key: "amount",
                  header: webMessages.invoiceLineAmount,
                  numeric: true,
                },
                {
                  key: "rate",
                  header: webMessages.invoiceTaxRate,
                  numeric: true,
                },
              ]}
              rows={invoice.lines.map((line) => ({
                description: line.description,
                quantity: line.quantity,
                unit: formatYen(line.unitPriceExclTax),
                amount: formatYen(line.amountExclTax),
                rate: `${Math.round(line.taxRate * 100)}%`,
              }))}
            />
            <AmountRows
              rows={[
                {
                  label: webMessages.adminSubtotalExcl,
                  amount: formatYen(invoice.totalExclTax),
                },
                {
                  label: webMessages.invoiceTaxLabel,
                  amount: formatYen(invoice.taxAmount),
                },
              ]}
              total={{
                label: webMessages.adminTotalIncl,
                amount: formatYen(invoice.totalInclTax),
              }}
            />
          </Card>
          <Card title={webMessages.invoiceBankHeading}>
            {invoice.paymentMethod === "bank_transfer" ? (
              <DefinitionList
                items={[
                  {
                    term: webMessages.invoiceBankName,
                    description: invoice.issuer.bankAccountName ?? notSet,
                  },
                  {
                    term: webMessages.invoiceBankBranch,
                    description: invoice.issuer.bankAccountBranch ?? notSet,
                  },
                  {
                    term: webMessages.invoiceBankAccountType,
                    description: invoice.issuer.bankAccountType ?? notSet,
                  },
                  {
                    term: webMessages.invoiceBankAccountNumber,
                    description: invoice.issuer.bankAccountNumber ?? notSet,
                  },
                ]}
              />
            ) : (
              <Hint>{webMessages.invoiceBankInPdf}</Hint>
            )}
          </Card>
        </div>
        <div>
          <Card title={webMessages.invoiceDetailTitle}>
            <DefinitionList
              items={[
                {
                  term: webMessages.invoiceIssuedOn,
                  description: formatDate(invoice.issuedOn),
                },
                {
                  term: webMessages.invoiceDueOn,
                  description: formatDate(invoice.dueOn),
                },
                {
                  term: webMessages.invoiceBillingName,
                  description: invoice.billingName,
                },
                {
                  term: webMessages.invoiceBillingAddress,
                  description: invoice.billingAddress,
                },
                {
                  term: webMessages.invoiceAcceptedPlan,
                  description: invoice.acceptedPlan.planName,
                },
                {
                  term: webMessages.invoiceAcceptedMonthlyPrice,
                  description: formatYen(
                    invoice.acceptedPlan.monthlyPriceExclTax,
                  ),
                },
                {
                  term: webMessages.invoiceAcceptedCredits,
                  description: invoice.acceptedPlan.credits,
                },
              ]}
            />
          </Card>
          <Card title={webMessages.invoiceIssuerHeading}>
            <DefinitionList
              items={[
                {
                  term: webMessages.invoiceServiceName,
                  description: invoice.issuer.serviceName,
                },
                {
                  term: webMessages.invoiceCompanyName,
                  description: invoice.issuer.companyName,
                },
                {
                  term: webMessages.invoiceCompanyAddress,
                  description: invoice.issuer.companyAddress,
                },
                {
                  term: webMessages.applicationInvoiceRegistrationNo,
                  description: invoice.issuer.invoiceRegistrationNo ?? notSet,
                },
              ]}
            />
          </Card>
        </div>
      </AdminColumns>
    </>
  );
}

export { MyInvoiceDetailPage, MyInvoiceListPage } from "./CustomerInvoices.js";
