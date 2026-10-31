import {
  type InvoiceDetail,
  type InvoiceListItem,
  webMessages,
} from "@kobito/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SignOutAction } from "../auth/SignOutAction.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";
import { ApiClientError } from "../platform/api-client.js";
import { MailText } from "../platform/contact.js";
import { formatDate, formatYen } from "../platform/format.js";
import {
  AmountRows,
  BackLink,
  Badge,
  type BadgeTone,
  Button,
  buttonClass,
  Card,
  DefinitionList,
  Hint,
  ListItem,
  Notice,
  Page,
  Table,
  Title,
} from "../ui/index.js";
import { CustomerTabBar } from "./CustomerTabBar.js";
import { invoiceStatus } from "./invoice-format.js";
import { useInvoicePdfDownload } from "./invoice-pdf.js";

type InvoiceClient = Pick<
  ReturnTypeApiClient,
  "getInvoices" | "getInvoice" | "getInvoicePdf" | "createInvoicePaymentLink"
>;

const unpaidStatuses: ReadonlyArray<InvoiceListItem["status"]> = [
  "issued",
  "failed",
  "overdue",
];

export function isUnpaid(invoice: Pick<InvoiceListItem, "status">): boolean {
  return unpaidStatuses.includes(invoice.status);
}

function statusTone(status: InvoiceListItem["status"]): BadgeTone {
  if (status === "paid") return "sage";
  if (status === "void") return "gray";
  return "warn";
}

export type CustomerInvoicesState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      invoices: InvoiceListItem[];
      /** 未払いの銀行振込の請求書だけ、振込先のために詳細を読む */
      details: Record<string, InvoiceDetail>;
    };

/** 請求書の一覧と、未払い分の振込先を読む。お客様本人の分だけが返る。 */
export function useCustomerInvoices(client: InvoiceClient) {
  const [state, setState] = useState<CustomerInvoicesState>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  // attempt is an intentional refetch trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry state must trigger another fetch
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void client
      .getInvoices()
      .then(async ({ invoices }) => {
        const details: Record<string, InvoiceDetail> = {};
        await Promise.all(
          invoices
            .filter(
              (item) =>
                isUnpaid(item) && item.paymentMethod === "bank_transfer",
            )
            .map(async (item) => {
              try {
                details[item.id] = await client.getInvoice(item.id);
              } catch {
                // 振込先が読めなくても請求額は表示する。
              }
            }),
        );
        if (active) setState({ status: "ready", invoices, details });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [client, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, retry };
}

/** 支払い方法ごとのご案内。カード情報はここでは扱わず、決済会社の画面に任せる。 */
export function InvoicePaymentGuide({
  invoice,
  issuer,
}: {
  invoice: Pick<InvoiceListItem, "paymentMethod" | "status">;
  issuer: InvoiceDetail["issuer"] | undefined;
}) {
  if (invoice.paymentMethod === "bank_transfer") {
    const rows = [
      [webMessages.invoiceBankName, issuer?.bankAccountName],
      [webMessages.invoiceBankBranch, issuer?.bankAccountBranch],
      [webMessages.invoiceBankAccountType, issuer?.bankAccountType],
      [webMessages.invoiceBankAccountNumber, issuer?.bankAccountNumber],
    ].filter((row): row is [string, string] => Boolean(row[1]));
    return (
      <>
        <h4 className="ui-card__subtitle">
          {webMessages.invoiceBankTransferHeading}
        </h4>
        {rows.length > 0 ? (
          <DefinitionList
            items={rows.map(([term, description]) => ({ term, description }))}
          />
        ) : (
          <Hint>{webMessages.invoiceBankInPdf}</Hint>
        )}
      </>
    );
  }
  if (invoice.paymentMethod === "card") {
    const cardGuidance =
      invoice.status === "issued"
        ? webMessages.invoiceCardGuidance
        : webMessages.invoiceCardNoLinkGuidance;
    return (
      <>
        <h4 className="ui-card__subtitle">{webMessages.invoiceCardHeading}</h4>
        <p className="ui-text">
          {invoice.status === "issued" ? (
            cardGuidance
          ) : (
            <MailText template={cardGuidance} />
          )}
        </p>
        <Hint>{webMessages.invoiceCardPrivacy}</Hint>
      </>
    );
  }
  return <p className="ui-text">{webMessages.invoiceOtherPaymentGuidance}</p>;
}

function PaymentLinkAction({
  invoice,
  apiClient,
  redirectTo = (url) => window.location.assign(url),
}: {
  invoice: InvoiceListItem;
  apiClient: InvoiceClient;
  redirectTo?: ((url: string) => void) | undefined;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<"unavailable" | "general" | null>(null);
  const busy = useRef(false);
  if (invoice.paymentMethod !== "card" || invoice.status !== "issued")
    return null;

  async function openPaymentPage() {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      const { redirectUrl } = await apiClient.createInvoicePaymentLink(
        invoice.id,
      );
      redirectTo(redirectUrl);
    } catch (cause) {
      busy.current = false;
      setError(
        cause instanceof ApiClientError &&
          cause.code === "payment_link_unavailable"
          ? "unavailable"
          : "general",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      <Button disabled={working} onClick={() => void openPaymentPage()}>
        {working
          ? webMessages.invoicePaymentLinkWorking
          : webMessages.invoicePaymentLinkAction}
      </Button>
      <Hint>{webMessages.invoiceHostedCardPrivacy}</Hint>
      {error === "unavailable" ? (
        <Notice tone="warn">
          <MailText template={webMessages.invoicePaymentUnavailable} />
        </Notice>
      ) : null}
      {error === "general" ? (
        <Notice tone="warn">{webMessages.invoicePaymentLinkError}</Notice>
      ) : null}
    </div>
  );
}

function InvoiceAmounts({
  invoice,
  totalLabel,
}: {
  invoice: Pick<InvoiceListItem, "totalExclTax" | "taxAmount" | "totalInclTax">;
  totalLabel: string;
}) {
  return (
    <AmountRows
      rows={[
        {
          label: webMessages.invoiceSubtotalExcl,
          amount: formatYen(invoice.totalExclTax),
        },
        {
          label: webMessages.invoiceTaxLabel,
          amount: formatYen(invoice.taxAmount),
        },
      ]}
      total={{ label: totalLabel, amount: formatYen(invoice.totalInclTax) }}
    />
  );
}

function DueNotice({
  invoice,
  initialStage,
}: {
  invoice: InvoiceListItem;
  initialStage: boolean;
}) {
  if (invoice.status === "overdue") {
    return (
      <Notice tone="warn" title={webMessages.invoiceDueOverdueTitle}>
        {webMessages.invoiceDueOverdueNote}
      </Notice>
    );
  }
  if (invoice.status === "failed" && invoice.paymentMethod === "card") {
    return (
      <Notice tone="warn" title={webMessages.invoiceCardFailedTitle}>
        {webMessages.invoiceCardFailedNote}
      </Notice>
    );
  }
  return (
    <Notice
      tone="warn"
      title={`${webMessages.invoiceDuePrefix}${formatDate(invoice.dueOn)}`}
    >
      {initialStage ? webMessages.invoiceDueInitialNote : null}
    </Notice>
  );
}

/** 未払いの請求書1通。金額は税抜小計・消費税・税込合計の順に出す。 */
export function InvoicePayCard({
  invoice,
  detail,
  apiClient,
  redirectTo,
  initialStage = false,
}: {
  invoice: InvoiceListItem;
  detail: InvoiceDetail | undefined;
  apiClient: InvoiceClient;
  redirectTo?: ((url: string) => void) | undefined;
  initialStage?: boolean;
}) {
  return (
    <Card
      title={webMessages.invoiceUnpaidHeading.replace(
        "{no}",
        invoice.invoiceNo,
      )}
      action={
        <Badge tone={statusTone(invoice.status)}>
          {invoiceStatus(invoice.status)}
        </Badge>
      }
    >
      <InvoiceAmounts
        invoice={invoice}
        totalLabel={
          initialStage
            ? webMessages.invoiceTotalLabelWaiting
            : webMessages.invoiceTotalLabel
        }
      />
      <DueNotice initialStage={initialStage} invoice={invoice} />
      <InvoicePaymentGuide invoice={invoice} issuer={detail?.issuer} />
      {invoice.preview ? <Hint>{webMessages.invoicePreviewShort}</Hint> : null}
      <div className="ui-actions">
        <PaymentLinkAction
          apiClient={apiClient}
          invoice={invoice}
          redirectTo={redirectTo}
        />
        <Link
          className={buttonClass("ghost")}
          to={`/me/invoices/${encodeURIComponent(invoice.id)}`}
        >
          {webMessages.invoiceOpen}
        </Link>
      </div>
    </Card>
  );
}

export function MyInvoiceListPage({
  apiClient,
  returnPath,
  returnLabel,
  accessNotice,
  showLogout,
  tabbed = false,
  redirectTo,
}: {
  apiClient: InvoiceClient;
  returnPath?: string | null | undefined;
  returnLabel?: string | undefined;
  accessNotice?: string | undefined;
  showLogout?: boolean | undefined;
  tabbed?: boolean | undefined;
  redirectTo?: ((url: string) => void) | undefined;
}) {
  const { state, retry } = useCustomerInvoices(apiClient);
  const invoices = state.status === "ready" ? state.invoices : [];
  const unpaid = invoices.filter(isUnpaid);
  const past = invoices.filter((item) => !isUnpaid(item));
  return (
    <>
      <Page tabbed={tabbed}>
        {returnPath ? (
          <BackLink component={Link} to={returnPath}>
            {returnLabel ?? webMessages.homeTitle}
          </BackLink>
        ) : null}
        <Title id="invoice-list-title">{webMessages.invoiceListTitle}</Title>
        {accessNotice ? <Notice tone="info">{accessNotice}</Notice> : null}
        {state.status === "loading" ? (
          <output className="ui-lead">{webMessages.invoiceListLoading}</output>
        ) : null}
        {state.status === "error" ? (
          <>
            <Notice tone="warn">{webMessages.invoiceListError}</Notice>
            <Button variant="ghost" onClick={retry}>
              {webMessages.invoiceRetry}
            </Button>
          </>
        ) : null}
        {state.status === "ready" && invoices.length === 0 ? (
          <p className="ui-lead">{webMessages.invoiceListEmpty}</p>
        ) : null}
        {state.status === "ready"
          ? unpaid.map((invoice) => (
              <InvoicePayCard
                detail={state.details[invoice.id]}
                invoice={invoice}
                apiClient={apiClient}
                redirectTo={redirectTo}
                key={invoice.id}
              />
            ))
          : null}
        {past.length > 0 ? (
          <Card title={webMessages.invoicePast}>
            {past.map((invoice) => (
              <ListItem
                badge={
                  <Badge tone={statusTone(invoice.status)}>
                    {invoiceStatus(invoice.status)}
                  </Badge>
                }
                component={Link}
                key={invoice.id}
                meta={webMessages.invoicePaidMeta
                  .replace("{no}", invoice.invoiceNo)
                  .replace("{date}", formatDate(invoice.issuedOn))}
                title={formatYen(invoice.totalInclTax)}
                to={`/me/invoices/${encodeURIComponent(invoice.id)}`}
              />
            ))}
          </Card>
        ) : null}
        {showLogout ? <SignOutAction /> : null}
      </Page>
      {tabbed ? <CustomerTabBar /> : null}
    </>
  );
}

export function MyInvoiceDetailPage({
  apiClient,
  tabbed = false,
  redirectTo,
}: {
  apiClient: InvoiceClient;
  tabbed?: boolean | undefined;
  redirectTo?: ((url: string) => void) | undefined;
}) {
  const { id = "" } = useParams();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { downloading, downloadError, downloadPdf } = useInvoicePdfDownload(
    apiClient,
    invoice,
  );

  // attempt is an intentional refetch trigger.
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
  }, [apiClient, attempt, id]);

  return (
    <>
      <Page tabbed={tabbed}>
        <BackLink component={Link} to="/me/invoices">
          {webMessages.invoiceListTitle}
        </BackLink>
        {loading ? (
          <output className="ui-lead">{webMessages.invoiceListLoading}</output>
        ) : null}
        {error ? (
          <>
            <Notice tone="warn">{webMessages.invoiceDetailError}</Notice>
            <Button
              variant="ghost"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {webMessages.invoiceRetry}
            </Button>
          </>
        ) : null}
        {!loading && !error && invoice ? (
          <>
            <Title id="invoice-detail-title">
              {webMessages.invoiceDetailTitle}
            </Title>
            {invoice.preview ? (
              <Notice tone="yellow">{webMessages.invoicePreviewWarning}</Notice>
            ) : null}
            <Card
              title={invoice.invoiceNo}
              action={
                <Badge tone={statusTone(invoice.status)}>
                  {invoiceStatus(invoice.status)}
                </Badge>
              }
            >
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
                    term: webMessages.invoicePlanName,
                    description: invoice.acceptedPlan.planName,
                  },
                ]}
              />
            </Card>
            <Card title={webMessages.invoiceLinesHeading}>
              <Table
                caption={webMessages.invoiceLinesHeading}
                columns={[
                  { key: "d", header: webMessages.invoiceLineDescription },
                  {
                    key: "q",
                    header: webMessages.invoiceLineQuantity,
                    numeric: true,
                  },
                  {
                    key: "a",
                    header: webMessages.invoiceLineAmount,
                    numeric: true,
                  },
                ]}
                rows={invoice.lines.map((line) => ({
                  d: line.description,
                  q: line.quantity,
                  a: formatYen(line.amountExclTax),
                }))}
              />
              <InvoiceAmounts
                invoice={invoice}
                totalLabel={webMessages.invoiceTotalLabel}
              />
            </Card>
            {isUnpaid(invoice) ? (
              <Card title={webMessages.invoiceBankHeading}>
                <DueNotice initialStage={false} invoice={invoice} />
                <InvoicePaymentGuide
                  invoice={invoice}
                  issuer={invoice.issuer}
                />
                <PaymentLinkAction
                  apiClient={apiClient}
                  invoice={invoice}
                  redirectTo={redirectTo}
                />
              </Card>
            ) : null}
            <Card title={webMessages.invoiceIssuerHeading}>
              <DefinitionList
                items={[
                  {
                    term: webMessages.invoiceCompanyName,
                    description: invoice.issuer.companyName,
                  },
                  {
                    term: webMessages.invoiceCompanyAddress,
                    description: invoice.issuer.companyAddress,
                  },
                  ...(invoice.issuer.invoiceRegistrationNo
                    ? [
                        {
                          term: webMessages.applicationInvoiceRegistrationNo,
                          description: invoice.issuer.invoiceRegistrationNo,
                        },
                      ]
                    : []),
                ]}
              />
            </Card>
            {downloadError ? (
              <Notice tone="warn">{webMessages.invoiceDownloadError}</Notice>
            ) : null}
            <Button disabled={downloading} onClick={() => void downloadPdf()}>
              {downloading
                ? webMessages.invoiceDownloadWorking
                : webMessages.invoiceDownload}
            </Button>
            {isUnpaid(invoice) ? (
              <Hint align="center">
                <MailText template={webMessages.invoiceChangeMethod} />
              </Hint>
            ) : null}
          </>
        ) : null}
      </Page>
      {tabbed ? <CustomerTabBar /> : null}
    </>
  );
}
