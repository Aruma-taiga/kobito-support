import {
  type AdminCancellation,
  type ContractStatus,
  contractStatuses,
  type InvoiceListItem,
  webMessages,
} from "@kobito/shared";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AdminApiClient } from "../platform/admin-api-client.js";
import { formatYen } from "../platform/format.js";
import {
  ActionBar,
  AdminColumns,
  AdminHeading,
  Badge,
  Button,
  buttonClass,
  Card,
  DefinitionList,
  Field,
  FilterChips,
  Hint,
  Notice,
  Table,
} from "../ui/index.js";
import {
  contractStatusLabel,
  contractStatusTone,
  formatExclIncl,
  formatJstShort,
  formatPaymentMethod,
  formatPlanSummary,
} from "./admin-format.js";

type StatusFilter = ContractStatus | "all";

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: webMessages.adminFilterAll },
  ...contractStatuses.map((status) => ({
    value: status,
    label: contractStatusLabel(status),
  })),
];

export function AdminQueuePage({ apiClient }: { apiClient: AdminApiClient }) {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<Awaited<
    ReturnType<AdminApiClient["getApplications"]>
  > | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void apiClient
      .getApplications({
        ...(status === "all" ? {} : { status }),
        q: query,
        page,
        pageSize: 25,
      })
      .then((response) => {
        if (active) setResult(response);
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
  }, [apiClient, page, query, status]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQuery(searchInput.trim());
  }

  const totalPages = result
    ? Math.max(1, Math.ceil(result.total / result.pageSize))
    : 1;
  const items = !loading && !error && result ? result.items : [];
  return (
    <>
      <AdminHeading
        id="admin-queue-title"
        title={webMessages.adminQueueTitle}
        actions={
          <form className="ui-search" onSubmit={search}>
            <input
              aria-label={webMessages.adminSearchLabel}
              className="ui-input"
              maxLength={100}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
              placeholder={webMessages.adminSearchPlaceholder}
              type="search"
              value={searchInput}
            />
            <Button variant="ghost" size="sm" type="submit">
              {webMessages.adminSearchButton}
            </Button>
          </form>
        }
      />
      <FilterChips
        label={webMessages.adminStatusFilterLabel}
        options={statusOptions}
        value={status}
        onChange={(value) => {
          setPage(1);
          setStatus(value);
        }}
      />
      {loading ? (
        <output className="ui-admin__lead">
          {webMessages.adminQueueLoading}
        </output>
      ) : null}
      {error ? (
        <Notice tone="warn">{webMessages.adminRequestError}</Notice>
      ) : null}
      {!loading && !error && result?.items.length === 0 ? (
        <Hint>{webMessages.adminQueueEmpty}</Hint>
      ) : null}
      {items.length ? (
        <Table
          caption={webMessages.adminCustomersTableLabel}
          highlightRows={items.flatMap((item, index) =>
            item.status === "under_review" ? [index] : [],
          )}
          columns={[
            { key: "shop", header: webMessages.adminColShop },
            { key: "status", header: webMessages.adminColStatus },
            { key: "plan", header: webMessages.adminColPlan },
            { key: "payment", header: webMessages.adminColPayment },
            { key: "submitted", header: webMessages.adminColSubmitted },
            { key: "action", header: "" },
          ]}
          rows={items.map((item) => ({
            shop: (
              <>
                <Link
                  to={`/admin/customers/${encodeURIComponent(item.customerId)}`}
                >
                  <b>{item.shopName}</b>
                </Link>
                <span className="ui-table__sub">
                  {item.contactName} · {item.email}
                </span>
              </>
            ),
            status: (
              <Badge tone={contractStatusTone(item.status)}>
                {contractStatusLabel(item.status)}
              </Badge>
            ),
            plan: (
              <>
                {item.planName}
                <span className="ui-table__sub">
                  {item.priceExclTax === null
                    ? webMessages.applicationCustomQuoteAfterReview
                    : formatExclIncl(item.priceExclTax)}
                </span>
              </>
            ),
            payment: formatPaymentMethod(item.paymentMethod),
            submitted: formatJstShort(item.submittedAt),
            action: (
              <Link
                className={buttonClass(
                  item.status === "under_review" ? "primary" : "ghost",
                  { size: "sm" },
                )}
                to={`/admin/customers/${encodeURIComponent(item.customerId)}`}
              >
                {item.status === "under_review"
                  ? webMessages.adminReviewAction
                  : webMessages.adminOpenAction}
              </Link>
            ),
          }))}
        />
      ) : null}
      {result ? (
        <nav className="ui-pager" aria-label={webMessages.adminQueueTitle}>
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => current - 1)}
          >
            {webMessages.adminPreviousPage}
          </Button>
          <span>
            {result.page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            {webMessages.adminNextPage}
          </Button>
        </nav>
      ) : null}
    </>
  );
}

export function AdminCustomerPage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  const { id = "" } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [data, setData] = useState<Awaited<
    ReturnType<AdminApiClient["getCustomerDetail"]>
  > | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [rejectionNote, setRejectionNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [declineSuccess, setDeclineSuccess] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveNotice, setApproveNotice] = useState<string | null>(null);
  const [issuedInvoice, setIssuedInvoice] = useState<InvoiceListItem | null>(
    null,
  );
  const [readiness, setReadiness] = useState<
    | { status: "loading" }
    | { status: "error" }
    | {
        status: "ready";
        canIssue: boolean;
        mode: "live" | "preview" | "unavailable";
      }
  >({ status: "loading" });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void apiClient
      .getCustomerDetail(id)
      .then((response) => {
        if (active) setData(response);
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
  }, [apiClient, id]);

  useEffect(() => {
    let active = true;
    setReadiness({ status: "loading" });
    void apiClient
      .getInvoiceReadiness()
      .then((value) => {
        if (active) {
          setReadiness({
            status: "ready",
            canIssue: value.canIssue,
            mode: value.mode,
          });
        }
      })
      .catch(() => {
        if (active) setReadiness({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [apiClient]);

  async function decline() {
    if (!data || declining || data.contract.status !== "under_review") return;
    setDeclining(true);
    setDeclineError(null);
    try {
      const response = await apiClient.declineApplication(data.application.id, {
        ...(rejectionNote.trim()
          ? { rejectionNote: rejectionNote.trim() }
          : {}),
      });
      setData((current) =>
        current
          ? {
              ...current,
              application: {
                ...current.application,
                reviewResult: "declined",
                rejectionNote: rejectionNote.trim() || null,
              },
              contract: { ...current.contract, status: response.status },
            }
          : current,
      );
      setDeclineOpen(false);
      setDeclineSuccess(true);
    } catch (caught) {
      setDeclineError(
        (caught as { code?: string })?.code === "conflict"
          ? webMessages.adminApplicationConflict
          : webMessages.adminDeclineError,
      );
    } finally {
      setDeclining(false);
    }
  }

  async function approve() {
    if (!data || approving || data.contract.status !== "under_review") return;
    setApproving(true);
    setApproveError(null);
    setApproveNotice(null);
    try {
      const response = await apiClient.approveApplication(data.application.id);
      setData((current) =>
        current
          ? {
              ...current,
              application: { ...current.application, reviewResult: "approved" },
              contract: { ...current.contract, status: response.status },
            }
          : current,
      );
      setApproveOpen(false);
      setApproveNotice(
        response.status === "quoting"
          ? webMessages.adminQuoteSuccess
          : response.invoice?.preview
            ? webMessages.adminApprovePreviewSuccess
            : webMessages.adminApproveSuccess,
      );
      setIssuedInvoice(response.invoice);
    } catch (caught) {
      setApproveError(
        (caught as { code?: string })?.code === "invoice_unavailable"
          ? webMessages.invoiceUnavailable
          : (caught as { code?: string })?.code === "conflict"
            ? webMessages.adminApplicationConflict
            : webMessages.adminApproveError,
      );
    } finally {
      setApproving(false);
    }
  }

  if (loading)
    return (
      <output className="ui-admin__lead">
        {webMessages.adminQueueLoading}
      </output>
    );
  if (error || !data)
    return (
      <>
        <AdminHeading title={webMessages.adminQueueTitle} />
        <Notice tone="warn">{webMessages.adminQueueError}</Notice>
        <Link
          className={buttonClass("ghost", { size: "sm" })}
          to="/admin/customers"
        >
          {webMessages.adminQueueTitle}
        </Link>
      </>
    );

  const paymentMethod = formatPaymentMethod(data.application.paymentMethod);
  const canReview =
    data.contract.status === "under_review" &&
    data.application.reviewResult === null;
  const shownTerms = data.application.shownTerms;
  const planName =
    typeof shownTerms.planName === "string" ? shownTerms.planName : "";
  const rawPrice = shownTerms.priceExclTax;
  const price =
    typeof shownTerms.priceExclTax === "number"
      ? shownTerms.priceExclTax
      : null;
  const credits =
    typeof shownTerms.credits === "number" ? shownTerms.credits : null;
  const hasPlanName = planName.trim().length > 0;
  const isFixedBankPlan =
    price !== null &&
    credits !== null &&
    hasPlanName &&
    data.application.paymentMethod === "bank_transfer";
  const isCustomPlan =
    rawPrice === null &&
    hasPlanName &&
    data.application.paymentMethod === "bank_transfer";
  const isUnsupportedPaymentMethod =
    hasPlanName &&
    data.application.paymentMethod !== "bank_transfer" &&
    (rawPrice === null || (price !== null && credits !== null));
  const isIncompleteSnapshot =
    !hasPlanName || (rawPrice !== null && (price === null || credits === null));
  const invoiceReady = readiness.status === "ready" && readiness.canIssue;
  const choosing = canReview && !approveOpen && !declineOpen;
  const consent = (given: boolean) =>
    given ? webMessages.adminConsentYes : webMessages.adminConsentNo;

  const applicationRows = [
    {
      term: webMessages.applicationContactName,
      description: data.customer.contactName,
    },
    { term: webMessages.emailLabel, description: data.customer.email },
    ...(data.customer.phone
      ? [
          {
            term: webMessages.applicationPhone,
            description: data.customer.phone,
          },
        ]
      : []),
    {
      term: webMessages.adminBillingDetails,
      description: (
        <>
          {data.customer.billingName}
          <br />
          {data.customer.billingAddress}
        </>
      ),
    },
    {
      term: webMessages.adminPlan,
      description: formatPlanSummary(planName, price, credits),
    },
    ...(paymentMethod
      ? [{ term: webMessages.adminPaymentMethod, description: paymentMethod }]
      : []),
    ...(data.customer.invoiceRegistrationNo
      ? [
          {
            term: webMessages.applicationInvoiceRegistrationNo,
            description: data.customer.invoiceRegistrationNo,
          },
        ]
      : []),
    ...(data.application.referralCode
      ? [
          {
            term: webMessages.applicationReferralCode,
            description: data.application.referralCode,
          },
        ]
      : []),
    ...(data.application.freeText
      ? [
          {
            term: webMessages.adminNotesHeading,
            description: data.application.freeText,
          },
        ]
      : []),
    ...(data.application.rejectionNote
      ? [
          {
            term: webMessages.adminDeclineReason,
            description: data.application.rejectionNote,
          },
        ]
      : []),
  ];
  const consentRows = [
    {
      term: webMessages.applicationTermsVersion,
      description: data.application.termsVersion,
    },
    {
      term: webMessages.applicationPrivacyVersion,
      description: data.application.privacyVersion,
    },
    {
      term: webMessages.applicationDisclosureVersion,
      description: data.application.disclosureVersion,
    },
    {
      term: webMessages.adminConsentBusinessShort,
      description: consent(data.application.consentBusinessUse),
    },
    {
      term: webMessages.adminConsentTermsShort,
      description: consent(data.application.consentTerms),
    },
    ...(data.application.consentPartnerShare !== null
      ? [
          {
            term: webMessages.adminConsentPartnerShort,
            description: consent(data.application.consentPartnerShare),
          },
        ]
      : []),
    {
      term: webMessages.adminConsentMarketingShort,
      description: consent(data.application.consentMarketing),
    },
    ...(price !== null
      ? [
          {
            term: webMessages.adminShownPrice,
            description: formatExclIncl(price),
          },
        ]
      : []),
  ];

  return (
    <>
      <AdminHeading
        id="admin-customer-title"
        crumb={
          <>
            <Link to="/admin/customers">{webMessages.adminQueueTitle}</Link> ›
          </>
        }
        title={data.customer.shopName}
        badge={
          <Badge tone={contractStatusTone(data.contract.status)}>
            {contractStatusLabel(data.contract.status)}
          </Badge>
        }
        actions={
          data.contract.status === "active" ||
          data.contract.status === "cancel_scheduled" ? (
            <Link
              className={buttonClass("ghost", { size: "sm" })}
              to={`/admin/requests/new?contractId=${encodeURIComponent(data.contract.id)}`}
            >
              {webMessages.adminRequestsNew}
            </Link>
          ) : data.contract.status === "quoting" ||
            data.contract.status === "awaiting_quote_approval" ? (
            <Link
              className={buttonClass("primary", { size: "sm" })}
              to={`/admin/customers/${encodeURIComponent(data.customer.id)}/plan-quote`}
            >
              {data.contract.status === "quoting"
                ? webMessages.adminPlanQuoteCreate
                : webMessages.adminPlanQuoteTitle}
            </Link>
          ) : null
        }
      />
      <AdminColumns>
        <div>
          <Card
            title={webMessages.adminApplicationContentHeading}
            action={
              <span className="ui-table__sub">
                {webMessages.adminRecordedAt.replace(
                  "{date}",
                  formatJstShort(data.application.submittedAt),
                )}
              </span>
            }
          >
            <DefinitionList items={applicationRows} />
          </Card>
          <Card title={webMessages.adminConsentSummary}>
            <DefinitionList items={consentRows} />
          </Card>
        </div>
        <div>
          <Card
            title={webMessages.adminDetailTitle}
            className="ui-card--accent"
          >
            {canReview ? (
              <p className="ui-admin__lead">
                {webMessages.adminReviewPanelLead}
              </p>
            ) : null}
            {declineSuccess ? (
              <Notice live>{webMessages.adminDeclineSuccess}</Notice>
            ) : null}
            {declineError ? <Notice tone="warn">{declineError}</Notice> : null}
            {approveNotice ? <Notice live>{approveNotice}</Notice> : null}
            {approveError ? <Notice tone="warn">{approveError}</Notice> : null}
            {issuedInvoice ? (
              <p>
                <Link
                  to={`/admin/invoices/${encodeURIComponent(issuedInvoice.id)}`}
                >
                  {issuedInvoice.invoiceNo}
                </Link>{" "}
                <span className="ui-table__sub">
                  {webMessages.adminTotalIncl}{" "}
                  {formatYen(issuedInvoice.totalInclTax)}
                </span>
              </p>
            ) : null}
            {choosing && isIncompleteSnapshot ? (
              <Hint>{webMessages.adminReviewSnapshotIncomplete}</Hint>
            ) : null}
            {choosing && isUnsupportedPaymentMethod ? (
              <Hint>{webMessages.adminInvoicePaymentUnsupported}</Hint>
            ) : null}
            {choosing && isFixedBankPlan && readiness.status === "loading" ? (
              <output className="ui-admin__lead">
                {webMessages.invoiceReadinessLoading}
              </output>
            ) : null}
            {choosing && isFixedBankPlan && readiness.status === "error" ? (
              <Notice tone="warn">{webMessages.invoiceReadinessError}</Notice>
            ) : null}
            {choosing &&
            isFixedBankPlan &&
            readiness.status === "ready" &&
            !readiness.canIssue ? (
              <Notice tone="warn">{webMessages.invoiceUnavailable}</Notice>
            ) : null}
            {canReview && approveOpen && !declineOpen ? (
              <section aria-labelledby="admin-approve-confirm">
                <h4 className="ui-card__subtitle" id="admin-approve-confirm">
                  {isCustomPlan
                    ? webMessages.adminQuoteConfirm
                    : readiness.status === "ready" &&
                        readiness.mode === "preview"
                      ? webMessages.adminApprovePreviewConfirm
                      : webMessages.adminApproveConfirm}
                </h4>
                {readiness.status === "ready" &&
                readiness.mode === "preview" ? (
                  <Notice tone="yellow">
                    {webMessages.invoicePreviewWarning}
                  </Notice>
                ) : null}
                {isFixedBankPlan ? (
                  <p>{formatPlanSummary(planName, price, credits)}</p>
                ) : null}
                <ActionBar>
                  <Button
                    size="sm"
                    disabled={approving}
                    onClick={() => void approve()}
                  >
                    {approving
                      ? isCustomPlan
                        ? webMessages.adminQuoteWorking
                        : webMessages.adminApproveWorking
                      : isCustomPlan
                        ? webMessages.adminQuoteConfirmButton
                        : webMessages.adminApproveConfirmButton}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={approving}
                    onClick={() => setApproveOpen(false)}
                  >
                    {webMessages.adminApproveCancel}
                  </Button>
                </ActionBar>
              </section>
            ) : null}
            {canReview && declineOpen && !approveOpen ? (
              <section aria-labelledby="admin-decline-confirm">
                <h4 className="ui-card__subtitle" id="admin-decline-confirm">
                  {webMessages.adminDeclineConfirm}
                </h4>
                <Field label={webMessages.adminDeclineReason}>
                  <textarea
                    maxLength={500}
                    onChange={(event) =>
                      setRejectionNote(event.currentTarget.value)
                    }
                    value={rejectionNote}
                  />
                </Field>
                <ActionBar>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={declining}
                    onClick={() => void decline()}
                  >
                    {declining
                      ? webMessages.adminDeclineWorking
                      : webMessages.adminDeclineConfirmButton}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={declining}
                    onClick={() => setDeclineOpen(false)}
                  >
                    {webMessages.adminDeclineCancel}
                  </Button>
                </ActionBar>
              </section>
            ) : null}
            {choosing ? (
              <ActionBar>
                {isFixedBankPlan && invoiceReady ? (
                  <Button size="sm" onClick={() => setApproveOpen(true)}>
                    {webMessages.adminApprove}
                  </Button>
                ) : null}
                {isCustomPlan ? (
                  <Button size="sm" onClick={() => setApproveOpen(true)}>
                    {webMessages.adminApproveCustom}
                  </Button>
                ) : null}
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setDeclineOpen(true)}
                >
                  {webMessages.adminDecline}
                </Button>
              </ActionBar>
            ) : null}
            {choosing ? (
              <Hint>{webMessages.adminReviewDeclineLead}</Hint>
            ) : null}
          </Card>
        </div>
      </AdminColumns>
      {data.contract.status === "active" ||
      data.contract.status === "cancel_scheduled" ||
      data.contract.status === "ended" ? (
        <CancellationPanel
          apiClient={apiClient}
          contractId={data.contract.id}
        />
      ) : null}
    </>
  );
}

function CancellationPanel({
  apiClient,
  contractId,
}: {
  apiClient: AdminApiClient;
  contractId: string;
}) {
  const [record, setRecord] = useState<AdminCancellation | null>(null);
  const [checklist, setChecklist] = useState({
    removalRequested: false,
    removablePermissionsRemoved: false,
    complete: false,
  });
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void apiClient
      .getCancellation(contractId)
      .then((value) => {
        if (active) {
          setRecord(value);
          setChecklist(value.checklist);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [apiClient, contractId]);
  async function update(operation: () => Promise<AdminCancellation>) {
    setError(false);
    setSaved(false);
    try {
      const value = await operation();
      setRecord(value);
      setChecklist(value.checklist);
      setConfirming(false);
      setSaved(true);
    } catch {
      setError(true);
    }
  }
  return (
    <Card title={webMessages.adminCancellationTitle}>
      {error ? (
        <Notice tone="warn">{webMessages.adminCancellationError}</Notice>
      ) : null}
      {saved ? (
        <Notice live>{webMessages.adminCancellationSuccess}</Notice>
      ) : null}
      {record ? (
        <p>
          {webMessages.adminStatusLabel}: {contractStatusLabel(record.status)}
          {record.endsOn
            ? ` ／ ${webMessages.adminCancellationEndDateLabel}: ${record.endsOn}`
            : ""}
        </p>
      ) : null}
      {record?.status === "active" ? (
        confirming ? (
          <section>
            <p>
              {webMessages.adminCancellationScheduleConfirm.replace(
                "{date}",
                record.currentPeriodEndsOn ?? "",
              )}
            </p>
            <ActionBar>
              <Button
                size="sm"
                disabled={!record.currentPeriodEndsOn}
                onClick={() =>
                  void update(() => apiClient.scheduleCancellation(contractId))
                }
              >
                {webMessages.adminCancellationSchedule}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                {webMessages.adminApproveCancel}
              </Button>
            </ActionBar>
          </section>
        ) : (
          <Button
            size="sm"
            disabled={!record.currentPeriodEndsOn}
            onClick={() => setConfirming(true)}
          >
            {webMessages.adminCancellationSchedule}
          </Button>
        )
      ) : null}
      {record?.status === "cancel_scheduled" ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void update(() => apiClient.revokeCancellation(contractId))
          }
        >
          {webMessages.adminCancellationRevoke}
        </Button>
      ) : null}
      {record ? (
        <section>
          <h4>{webMessages.adminCancellationChecklist}</h4>
          {(
            [
              [
                "removalRequested",
                webMessages.adminCancellationRemovalRequested,
              ],
              [
                "removablePermissionsRemoved",
                webMessages.adminCancellationPermissionsRemoved,
              ],
              ["complete", webMessages.adminCancellationChecklistComplete],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={checklist[key]}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setChecklist((current) => ({ ...current, [key]: checked }));
                }}
              />{" "}
              {label}
            </label>
          ))}
          <Button
            size="sm"
            onClick={() =>
              void update(() =>
                apiClient.updateCancellationChecklist(contractId, checklist),
              )
            }
          >
            {webMessages.adminCancellationSave}
          </Button>
        </section>
      ) : null}
    </Card>
  );
}
