import {
  type AdminRequestDetail,
  type AdminRequestSummary,
  type CompleteRequest,
  type CreateEstimate,
  type CreateRequest,
  type CustomerRequestDetail,
  type CustomerRequestSummary,
  completeRequestSchema,
  createEstimateSchema,
  createRequestSchema,
  type RequestCompletion,
  type RequestEstimate,
  type RequestStatus,
  webMessages,
} from "@kobito/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  type AdminApiClient,
  AdminApiError,
} from "../platform/admin-api-client.js";
import {
  ApiClientError,
  type ReturnTypeApiClient,
} from "../platform/api-client.js";

function requestStatusLabel(status: RequestStatus): string {
  switch (status) {
    case "received":
      return webMessages.requestStatusReceived;
    case "awaiting_approval":
      return webMessages.requestStatusAwaitingApproval;
    case "in_progress":
      return webMessages.requestStatusInProgress;
    case "done":
      return webMessages.requestStatusDone;
    case "withdrawn":
      return webMessages.requestStatusWithdrawn;
  }
}

function tokyoToday(): string {
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

export function AdminRequestListPage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  const [items, setItems] = useState<AdminRequestSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The counter is intentionally a dependency: changing it retries the list request.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally retries the list fetch.
  useEffect(() => {
    let current = true;
    setItems(null);
    setError(false);
    void apiClient
      .getAdminRequests()
      .then(({ items: result }) => {
        if (current) setItems(result);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [apiClient, attempt]);
  return (
    <main className="page-main">
      <section
        className="card admin-card"
        aria-labelledby="admin-requests-title"
      >
        <div className="request-page-heading">
          <h1 id="admin-requests-title">{webMessages.adminRequestsTitle}</h1>
          <Link className="secondary-button" to="/admin/requests/new">
            {webMessages.adminRequestsNew}
          </Link>
        </div>
        {items === null && !error ? (
          <output className="status-message">
            {webMessages.adminQueueLoading}
          </output>
        ) : null}
        {error ? (
          <>
            <p className="error-message" role="alert">
              {webMessages.requestsLoadError}
            </p>
            <button
              className="secondary-button"
              onClick={() => setAttempt((value) => value + 1)}
              type="button"
            >
              {webMessages.retry}
            </button>
          </>
        ) : null}
        {items?.length === 0 ? (
          <p className="muted-text">{webMessages.myRequestsEmpty}</p>
        ) : null}
        {items?.length ? (
          <div className="request-list">
            {items.map((item) => (
              <article className="request-list-item" key={item.id}>
                <Link to={`/admin/requests/${encodeURIComponent(item.id)}`}>
                  <strong>{item.summary}</strong>
                </Link>
                {item.urgent ? (
                  <p className="request-urgent-tag">
                    {webMessages.adminRequestUrgent}
                  </p>
                ) : null}
                <dl className="request-summary-list">
                  <dt>{webMessages.adminRequestReceivedOn}</dt>
                  <dd>{item.receivedOn}</dd>
                  <dt>{webMessages.adminRequestStatus}</dt>
                  <dd>{requestStatusLabel(item.status)}</dd>
                  {item.completion ? (
                    <>
                      <dt>{webMessages.adminRequestCompletedOn}</dt>
                      <dd>{item.completion.completedOn}</dd>
                      <dt>{webMessages.adminRequestActualCredits}</dt>
                      <dd>
                        {item.completion.actualCredits}{" "}
                        {webMessages.requestCreditUnit}
                      </dd>
                    </>
                  ) : item.latestEstimate ? (
                    <>
                      <dt>{webMessages.adminEstimateCredits}</dt>
                      <dd>
                        {item.latestEstimate.credits}{" "}
                        {webMessages.requestCreditUnit}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

export function AdminRequestCreatePage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [contracts, setContracts] = useState<
    Awaited<ReturnType<AdminApiClient["getRequestContracts"]>>["items"]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [contractId, setContractId] = useState(
    searchParams.get("contractId") ?? "",
  );
  const [receivedOn, setReceivedOn] = useState("");
  const [summary, setSummary] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  useEffect(() => {
    let current = true;
    void apiClient
      .getRequestContracts()
      .then((response) => {
        if (!current) return;
        setContracts(response.items);
        if (
          searchParams.get("contractId") &&
          response.items.some(
            (item) => item.contractId === searchParams.get("contractId"),
          )
        ) {
          setContractId(searchParams.get("contractId") ?? "");
        }
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
  }, [apiClient, searchParams]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const value: CreateRequest = { contractId, receivedOn, summary, urgent };
    const parsed = createRequestSchema.safeParse(value);
    if (!parsed.success) {
      setError(webMessages.requestValidationError);
      return;
    }
    idempotencyKey.current ??= crypto.randomUUID();
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiClient.createRequest(
        parsed.data,
        idempotencyKey.current,
      );
      idempotencyKey.current = null;
      navigate(`/admin/requests/${encodeURIComponent(created.id)}`, {
        replace: true,
      });
    } catch {
      setError(webMessages.requestActionError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-main">
      <section className="card admin-card" aria-labelledby="new-request-title">
        <Link className="admin-back-link" to="/admin/requests">
          {webMessages.adminRequestsTitle}
        </Link>
        <h1 id="new-request-title">{webMessages.adminRequestsNew}</h1>
        <p className="muted-text">{webMessages.adminRequestNewDescription}</p>
        {loadError ? (
          <p className="error-message" role="alert">
            {webMessages.requestsLoadError}
          </p>
        ) : null}
        {loading ? (
          <output className="status-message">
            {webMessages.adminQueueLoading}
          </output>
        ) : null}
        {!loading && !loadError && contracts.length === 0 ? (
          <p className="muted-text">
            {webMessages.adminRequestNoEligibleContract}
          </p>
        ) : null}
        {!loading && !loadError && contracts.length > 0 ? (
          <form noValidate onSubmit={(event) => void submit(event)}>
            <label className="field-label" htmlFor="request-contract">
              {webMessages.adminRequestCustomer}
            </label>
            <select
              id="request-contract"
              required
              value={contractId}
              onChange={(event) => setContractId(event.currentTarget.value)}
            >
              <option value="">{webMessages.requestSelectOption}</option>
              {contracts.map((item) => (
                <option key={item.contractId} value={item.contractId}>
                  {item.shopName}（{item.contactName}）
                  {item.status === "cancel_scheduled"
                    ? webMessages.adminRequestCancelScheduled
                    : ""}
                </option>
              ))}
            </select>
            <label className="field-label" htmlFor="request-received-on">
              {webMessages.adminRequestReceivedOn}
            </label>
            <input
              id="request-received-on"
              required
              type="date"
              value={receivedOn}
              onChange={(event) => setReceivedOn(event.currentTarget.value)}
            />
            <label className="field-label" htmlFor="request-summary">
              {webMessages.adminRequestSummary}
            </label>
            <textarea
              id="request-summary"
              maxLength={500}
              required
              value={summary}
              onChange={(event) => setSummary(event.currentTarget.value)}
            />
            <label className="request-check" htmlFor="request-urgent">
              <input
                id="request-urgent"
                type="checkbox"
                checked={urgent}
                onChange={(event) => setUrgent(event.currentTarget.checked)}
              />
              {webMessages.adminRequestUrgent}
            </label>
            {error ? (
              <p className="error-message" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="primary-button"
              disabled={submitting}
              type="submit"
            >
              {submitting
                ? webMessages.requestSendBusy
                : webMessages.adminRequestsCreate}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}

type EstimateDraft = Pick<
  RequestEstimate,
  | "credits"
  | "dueOn"
  | "workItems"
  | "doneCriteria"
  | "exclusions"
  | "customerPrep"
>;

function EstimateForm({
  apiClient,
  requestId,
  initial,
  onSent,
}: {
  apiClient: AdminApiClient;
  requestId: string;
  initial: EstimateDraft | undefined;
  onSent: () => Promise<void>;
}) {
  const [credits, setCredits] = useState(
    initial ? String(initial.credits) : "",
  );
  const [dueOn, setDueOn] = useState(initial?.dueOn ?? "");
  const [workItems, setWorkItems] = useState(
    initial?.workItems.join("\n") ?? "",
  );
  const [doneCriteria, setDoneCriteria] = useState(initial?.doneCriteria ?? "");
  const [exclusions, setExclusions] = useState(initial?.exclusions ?? "");
  const [customerPrep, setCustomerPrep] = useState(initial?.customerPrep ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<
    "validation" | "action" | "conflict" | null
  >(null);
  const idempotencyKey = useRef<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const value: CreateEstimate = {
      credits: Number(credits),
      dueOn,
      workItems: workItems
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      doneCriteria,
      exclusions: exclusions || null,
      customerPrep: customerPrep || null,
    };
    const parsed = createEstimateSchema.safeParse(value);
    if (!parsed.success) {
      setError("validation");
      return;
    }
    idempotencyKey.current ??= crypto.randomUUID();
    setSubmitting(true);
    setError(null);
    try {
      try {
        await apiClient.sendEstimate(
          requestId,
          parsed.data,
          idempotencyKey.current,
        );
      } catch (caught) {
        setError(
          caught instanceof AdminApiError &&
            ["request_conflict", "estimate_conflict"].includes(caught.code)
            ? "conflict"
            : "action",
        );
        return;
      }
      idempotencyKey.current = null;
      await onSent();
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form
      className="estimate-form"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <label className="field-label" htmlFor="estimate-credits">
        {webMessages.adminEstimateCredits}
      </label>
      <input
        id="estimate-credits"
        min="1"
        max="1000"
        required
        type="number"
        value={credits}
        onChange={(event) => setCredits(event.currentTarget.value)}
      />
      <label className="field-label" htmlFor="estimate-due-on">
        {webMessages.adminEstimateDueOn}
      </label>
      <input
        id="estimate-due-on"
        required
        type="date"
        value={dueOn}
        onChange={(event) => setDueOn(event.currentTarget.value)}
      />
      <label className="field-label" htmlFor="estimate-work-items">
        {webMessages.adminEstimateWorkItems}（
        {webMessages.adminEstimateWorkItemsHint}）
      </label>
      <textarea
        id="estimate-work-items"
        required
        value={workItems}
        onChange={(event) => setWorkItems(event.currentTarget.value)}
      />
      <label className="field-label" htmlFor="estimate-done-criteria">
        {webMessages.adminEstimateDoneCriteria}
      </label>
      <textarea
        id="estimate-done-criteria"
        required
        value={doneCriteria}
        onChange={(event) => setDoneCriteria(event.currentTarget.value)}
      />
      <label className="field-label" htmlFor="estimate-exclusions">
        {webMessages.adminEstimateExclusions}
      </label>
      <textarea
        id="estimate-exclusions"
        value={exclusions}
        onChange={(event) => setExclusions(event.currentTarget.value)}
      />
      <label className="field-label" htmlFor="estimate-customer-prep">
        {webMessages.adminEstimateCustomerPrep}
      </label>
      <textarea
        id="estimate-customer-prep"
        value={customerPrep}
        onChange={(event) => setCustomerPrep(event.currentTarget.value)}
      />
      {error ? (
        <p className="error-message" role="alert">
          {error === "validation"
            ? webMessages.requestValidationError
            : error === "conflict"
              ? webMessages.myRequestConflict
              : webMessages.requestActionError}
        </p>
      ) : null}
      <button className="primary-button" disabled={submitting} type="submit">
        {submitting
          ? webMessages.requestSendBusy
          : initial
            ? webMessages.adminEstimateRevise
            : webMessages.adminEstimateSend}
      </button>
    </form>
  );
}

function EstimateDisplay({
  estimate,
}: {
  estimate: NonNullable<AdminRequestDetail["latestEstimate"]>;
}) {
  return (
    <section
      className="estimate-card"
      aria-labelledby={`estimate-${estimate.id}`}
    >
      <h2 id={`estimate-${estimate.id}`}>
        {webMessages.myRequestEstimateTitle}（{webMessages.estimateVersion}{" "}
        {estimate.version}）
      </h2>
      <dl className="request-summary-list">
        <dt>{webMessages.estimateCredits}</dt>
        <dd>
          {estimate.credits} {webMessages.requestCreditUnit}
        </dd>
        <dt>{webMessages.estimateDueOn}</dt>
        <dd>{estimate.dueOn}</dd>
        <dt>{webMessages.estimateWorkItems}</dt>
        <dd>
          <ul>
            {estimate.workItems.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </dd>
        <dt>{webMessages.estimateDoneCriteria}</dt>
        <dd>{estimate.doneCriteria}</dd>
        {estimate.exclusions ? (
          <>
            <dt>{webMessages.estimateExclusions}</dt>
            <dd>{estimate.exclusions}</dd>
          </>
        ) : null}
        {estimate.customerPrep ? (
          <>
            <dt>{webMessages.estimateCustomerPrep}</dt>
            <dd>{estimate.customerPrep}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

function CompletionDisplay({
  completion,
  customer = false,
}: {
  completion: RequestCompletion;
  customer?: boolean;
}) {
  return (
    <section
      className="estimate-card"
      aria-label={webMessages.requestStatusDone}
    >
      <h2>{webMessages.requestStatusDone}</h2>
      <dl className="request-summary-list">
        <dt>
          {customer
            ? webMessages.myRequestCompletionDate
            : webMessages.adminRequestCompletedOn}
        </dt>
        <dd>{completion.completedOn}</dd>
        <dt>
          {customer
            ? webMessages.myRequestCompletionActualMinutes
            : webMessages.adminRequestActualMinutes}
        </dt>
        <dd>
          {completion.actualMinutes} {webMessages.requestMinuteUnit}
        </dd>
        <dt>
          {customer
            ? webMessages.myRequestCompletionActualCredits
            : webMessages.adminRequestActualCredits}
        </dt>
        <dd>
          {completion.actualCredits} {webMessages.requestCreditUnit}
        </dd>
        <dt>
          {customer
            ? webMessages.myRequestCompletionPeriod
            : webMessages.adminRequestReservedPeriod}
        </dt>
        <dd>
          {completion.reservedPeriod.startsOn}〜
          {completion.reservedPeriod.endsOn}
        </dd>
        <dt>
          {customer
            ? webMessages.myRequestCompletionReservedCredits
            : webMessages.adminRequestReservedCredits}
        </dt>
        <dd>
          {completion.reservedCredits} {webMessages.requestCreditUnit}
        </dd>
      </dl>
    </section>
  );
}

export function AdminRequestDetailPage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState<AdminRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [revise, setRevise] = useState(false);
  const [completedOn, setCompletedOn] = useState(() => tokyoToday());
  const [actualMinutes, setActualMinutes] = useState("");
  const [actualCredits, setActualCredits] = useState("");
  const [completionDraft, setCompletionDraft] =
    useState<CompleteRequest | null>(null);
  const [confirmingCompletion, setConfirmingCompletion] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<
    "validation" | "conflict" | "action" | null
  >(null);
  const [completionSucceeded, setCompletionSucceeded] = useState(false);
  const [completionRefreshError, setCompletionRefreshError] = useState(false);
  const load = async () => {
    const result = await apiClient.getAdminRequest(id);
    setDetail(result);
  };
  // The counter is intentionally a dependency: changing it retries the detail request.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally retries the detail fetch.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    void apiClient
      .getAdminRequest(id)
      .then((result) => {
        if (current) {
          setDetail(result);
          setRefreshError(false);
        }
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [apiClient, id, attempt]);
  if (loading)
    return (
      <main className="page-main">
        <output className="status-message">
          {webMessages.adminQueueLoading}
        </output>
      </main>
    );
  if (error || !detail)
    return (
      <main className="page-main">
        <section className="card admin-card">
          <p className="error-message" role="alert">
            {webMessages.requestsLoadError}
          </p>
          <button
            className="secondary-button"
            onClick={() => setAttempt((value) => value + 1)}
            type="button"
          >
            {webMessages.retry}
          </button>
        </section>
      </main>
    );
  const canSend =
    detail.status === "received" || detail.status === "awaiting_approval";
  const canComplete =
    detail.status === "in_progress" &&
    detail.completion === null &&
    completionError !== "conflict";
  const completionExceedsEstimate =
    detail.completion !== null &&
    detail.latestEstimate !== null &&
    detail.completion.actualCredits > detail.latestEstimate.credits;

  function prepareCompletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (completing || !detail) return;
    const parsed = completeRequestSchema.safeParse({
      completedOn,
      actualMinutes: actualMinutes === "" ? Number.NaN : Number(actualMinutes),
      actualCredits: actualCredits === "" ? Number.NaN : Number(actualCredits),
    });
    if (
      !parsed.success ||
      parsed.data.completedOn < detail.receivedOn ||
      parsed.data.completedOn > tokyoToday()
    ) {
      setCompletionError("validation");
      return;
    }
    setCompletionError(null);
    setCompletionDraft(parsed.data);
    setConfirmingCompletion(true);
  }

  async function complete() {
    if (completing || !completionDraft || !detail) return;
    setCompleting(true);
    setCompletionError(null);
    setCompletionRefreshError(false);
    try {
      const result = await apiClient.completeRequest(id, completionDraft);
      setConfirmingCompletion(false);
      setCompletionDraft(null);
      setCompletionSucceeded(true);
      setDetail({ ...detail, status: result.status, completion: result });
    } catch (caught) {
      setCompletionSucceeded(false);
      if (
        caught instanceof AdminApiError &&
        caught.code === "request_conflict"
      ) {
        setCompletionError("conflict");
        setConfirmingCompletion(false);
        try {
          await load();
        } catch {
          setCompletionRefreshError(true);
        }
      } else if (
        caught instanceof AdminApiError &&
        caught.code === "validation_error"
      ) {
        setCompletionError("validation");
        setConfirmingCompletion(false);
      } else {
        // Keep the reviewed values in the dialog so an identical retry is safe.
        setCompletionError("action");
      }
    } finally {
      setCompleting(false);
    }
  }
  return (
    <main className="page-main">
      <section
        className="card admin-card"
        aria-labelledby="request-detail-title"
      >
        <Link className="admin-back-link" to="/admin/requests">
          {webMessages.adminRequestsTitle}
        </Link>
        <h1 id="request-detail-title">{detail.summary}</h1>
        <dl className="request-summary-list">
          <dt>{webMessages.adminRequestCustomer}</dt>
          <dd>
            {detail.customer.shopName}（{detail.customer.contactName}）
          </dd>
          <dt>{webMessages.adminRequestReceivedOn}</dt>
          <dd>{detail.receivedOn}</dd>
          <dt>{webMessages.adminRequestStatus}</dt>
          <dd>{requestStatusLabel(detail.status)}</dd>
        </dl>
        {detail.urgent ? (
          <p className="request-urgent-tag">{webMessages.adminRequestUrgent}</p>
        ) : null}
        <h2>{webMessages.myRequestEstimateTitle}</h2>
        {detail.estimates.map((item) => (
          <EstimateDisplay key={item.id} estimate={item} />
        ))}
        {detail.completion ? (
          <CompletionDisplay completion={detail.completion} />
        ) : null}
        {completionSucceeded ? (
          <output className="notice info">
            {webMessages.adminRequestCompletionSuccess}
          </output>
        ) : null}
        {completionExceedsEstimate ? (
          <p className="notice info" role="note">
            {webMessages.adminRequestActualExceedsEstimate}
          </p>
        ) : null}
        {completionError === "conflict" ? (
          <p className="error-message" role="alert">
            {webMessages.adminRequestCompletionConflict}
          </p>
        ) : null}
        {completionError === "validation" ? (
          <p className="error-message" role="alert">
            {webMessages.adminRequestCompletionValidation}
          </p>
        ) : null}
        {completionError === "action" ? (
          <p className="error-message" role="alert">
            {webMessages.requestActionError}
          </p>
        ) : null}
        {completionRefreshError ? (
          <p className="error-message" role="alert">
            {webMessages.requestsLoadError}
          </p>
        ) : null}
        {completionError === "conflict" || completionRefreshError ? (
          <button
            className="secondary-button"
            onClick={() => {
              setCompletionError(null);
              setCompletionRefreshError(false);
              setAttempt((value) => value + 1);
            }}
            type="button"
          >
            {webMessages.retry}
          </button>
        ) : null}
        {refreshError ? (
          <>
            <p className="error-message" role="alert">
              {webMessages.adminEstimateSentRefreshError}
            </p>
            <button
              className="secondary-button"
              onClick={() => setAttempt((value) => value + 1)}
              type="button"
            >
              {webMessages.retry}
            </button>
          </>
        ) : null}
        {!refreshError && canSend && (!detail.latestEstimate || revise) ? (
          <>
            {detail.latestEstimate && revise ? (
              <button
                className="secondary-button"
                onClick={() => setRevise(false)}
                type="button"
              >
                {webMessages.myRequestCancel}
              </button>
            ) : null}
            {!revise ? <h2>{webMessages.adminRequestEstimate}</h2> : null}
            <EstimateForm
              apiClient={apiClient}
              requestId={id}
              initial={
                revise && detail.latestEstimate
                  ? detail.latestEstimate
                  : undefined
              }
              onSent={async () => {
                setRevise(false);
                try {
                  await load();
                  setRefreshError(false);
                } catch {
                  setRefreshError(true);
                }
              }}
            />
          </>
        ) : null}
        {!refreshError && canSend && detail.latestEstimate && !revise ? (
          <button
            className="primary-button"
            onClick={() => setRevise(true)}
            type="button"
          >
            {webMessages.adminEstimateRevise}
          </button>
        ) : null}
        {canComplete ? (
          <form
            className="estimate-form request-completion-form"
            noValidate
            onSubmit={prepareCompletion}
          >
            <h2>{webMessages.adminRequestComplete}</h2>
            <label className="field-label" htmlFor="request-completed-on">
              {webMessages.adminRequestCompletedOn}
            </label>
            <input
              id="request-completed-on"
              type="date"
              required
              min={detail.receivedOn}
              max={tokyoToday()}
              value={completedOn}
              disabled={confirmingCompletion || completing}
              onChange={(event) => setCompletedOn(event.currentTarget.value)}
            />
            <label className="field-label" htmlFor="request-actual-minutes">
              {webMessages.adminRequestActualMinutes}
            </label>
            <input
              id="request-actual-minutes"
              type="number"
              min="0"
              max="2147483647"
              step="1"
              required
              value={actualMinutes}
              disabled={confirmingCompletion || completing}
              onChange={(event) => setActualMinutes(event.currentTarget.value)}
            />
            <label className="field-label" htmlFor="request-actual-credits">
              {webMessages.adminRequestActualCredits}
            </label>
            <input
              id="request-actual-credits"
              type="number"
              min="0"
              max="2147483647"
              step="1"
              required
              value={actualCredits}
              disabled={confirmingCompletion || completing}
              onChange={(event) => setActualCredits(event.currentTarget.value)}
            />
            {completionError === "validation" ? (
              <p className="error-message" role="alert">
                {webMessages.adminRequestCompletionValidation}
              </p>
            ) : null}
            <button
              className="primary-button"
              type="submit"
              disabled={confirmingCompletion || completing}
            >
              {webMessages.adminRequestComplete}
            </button>
          </form>
        ) : null}
        {confirmingCompletion && completionDraft ? (
          <section
            className="request-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-completion-confirm-title"
          >
            <h2 id="request-completion-confirm-title">
              {webMessages.adminRequestCompletionConfirm}
            </h2>
            <dl className="request-summary-list">
              <dt>{webMessages.adminRequestSummary}</dt>
              <dd>{detail.summary}</dd>
              <dt>{webMessages.adminRequestCustomer}</dt>
              <dd>
                {detail.customer.shopName}（{detail.customer.contactName}）
              </dd>
              {detail.latestEstimate ? (
                <>
                  <dt>{webMessages.adminEstimateCredits}</dt>
                  <dd>
                    {detail.latestEstimate.credits}{" "}
                    {webMessages.requestCreditUnit}
                  </dd>
                </>
              ) : null}
              <dt>{webMessages.adminRequestCompletedOn}</dt>
              <dd>{completionDraft.completedOn}</dd>
              <dt>{webMessages.adminRequestActualMinutes}</dt>
              <dd>
                {completionDraft.actualMinutes} {webMessages.requestMinuteUnit}
              </dd>
              <dt>{webMessages.adminRequestActualCredits}</dt>
              <dd>
                {completionDraft.actualCredits} {webMessages.requestCreditUnit}
              </dd>
            </dl>
            {detail.latestEstimate &&
            completionDraft.actualCredits > detail.latestEstimate.credits ? (
              <p className="notice info" role="note">
                {webMessages.adminRequestActualExceedsEstimate}
              </p>
            ) : null}
            {completionError === "action" ? (
              <p className="error-message" role="alert">
                {webMessages.requestActionError}
              </p>
            ) : null}
            <div className="admin-actions">
              <button
                className="primary-button"
                disabled={completing}
                onClick={() => void complete()}
                type="button"
              >
                {completing
                  ? webMessages.requestSendBusy
                  : webMessages.adminRequestComplete}
              </button>
              <button
                className="secondary-button"
                disabled={completing}
                onClick={() => {
                  setConfirmingCompletion(false);
                  setCompletionError(null);
                }}
                type="button"
              >
                {webMessages.myRequestCancel}
              </button>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

export function MyRequestsPage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  const [items, setItems] = useState<CustomerRequestSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The counter is intentionally a dependency: changing it retries the list request.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally retries the list fetch.
  useEffect(() => {
    let current = true;
    setItems(null);
    setError(false);
    void apiClient
      .getCustomerRequests()
      .then(({ items: result }) => {
        if (current) setItems(result);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [apiClient, attempt]);
  return (
    <main className="page-main">
      <section
        className="card request-card"
        aria-labelledby="my-requests-title"
      >
        <Link className="admin-back-link" to="/me">
          {webMessages.homeTitle}
        </Link>
        <h1 id="my-requests-title">{webMessages.myRequestsTitle}</h1>
        {items === null && !error ? (
          <output className="status-message">
            {webMessages.profileLoading}
          </output>
        ) : null}
        {error ? (
          <>
            <p className="error-message" role="alert">
              {webMessages.requestsLoadError}
            </p>
            <button
              className="secondary-button"
              onClick={() => setAttempt((value) => value + 1)}
              type="button"
            >
              {webMessages.retry}
            </button>
          </>
        ) : null}
        {items?.length === 0 ? (
          <p className="muted-text">{webMessages.myRequestsEmpty}</p>
        ) : null}
        {items?.length ? (
          <div className="request-list">
            {items.map((item) => (
              <article className="request-list-item" key={item.id}>
                <Link to={`/me/requests/${encodeURIComponent(item.id)}`}>
                  <strong>{item.summary}</strong>
                </Link>
                <dl className="request-summary-list">
                  <dt>{webMessages.adminRequestStatus}</dt>
                  <dd>{requestStatusLabel(item.status)}</dd>
                  <dt>{webMessages.adminRequestReceivedOn}</dt>
                  <dd>{item.receivedOn}</dd>
                  {item.completion ? (
                    <>
                      <dt>{webMessages.myRequestCompletionDate}</dt>
                      <dd>{item.completion.completedOn}</dd>
                      <dt>{webMessages.myRequestCompletionActualCredits}</dt>
                      <dd>
                        {item.completion.actualCredits}{" "}
                        {webMessages.requestCreditUnit}
                      </dd>
                    </>
                  ) : item.latestEstimate ? (
                    <>
                      <dt>{webMessages.estimateCredits}</dt>
                      <dd>
                        {item.latestEstimate.credits}{" "}
                        {webMessages.requestCreditUnit}
                      </dd>
                      <dt>{webMessages.estimateDueOn}</dt>
                      <dd>{item.latestEstimate.dueOn}</dd>
                    </>
                  ) : null}
                </dl>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

export function MyRequestDetailPage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState<CustomerRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<
    "insufficient" | "conflict" | "generic" | null
  >(null);
  const [refreshError, setRefreshError] = useState(false);
  const [approved, setApproved] = useState(false);
  // The counter is intentionally a dependency: changing it retries the detail request.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally retries the detail fetch.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    void apiClient
      .getCustomerRequest(id)
      .then((result) => {
        if (current) setDetail(result);
      })
      .catch((caught: unknown) => {
        if (!current) return;
        if (caught instanceof ApiClientError && caught.code === "unauthorized")
          setError(true);
        else setError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [apiClient, id, attempt]);
  async function approve() {
    if (submitting || !detail?.latestEstimate) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await apiClient.approveEstimate(detail.latestEstimate.id);
    } catch (caught) {
      if (
        caught instanceof ApiClientError &&
        caught.code === "insufficient_credits"
      )
        setActionError("insufficient");
      else if (
        caught instanceof ApiClientError &&
        ["request_conflict", "estimate_conflict"].includes(caught.code)
      )
        setActionError("conflict");
      else setActionError("generic");
      setConfirming(false);
      try {
        setDetail(await apiClient.getCustomerRequest(id));
      } catch {
        // Keep the actionable mutation error visible when a follow-up read also fails.
      }
      setSubmitting(false);
      return;
    }
    setApproved(true);
    setConfirming(false);
    try {
      setDetail(await apiClient.getCustomerRequest(id));
      setRefreshError(false);
    } catch {
      setRefreshError(true);
    } finally {
      setSubmitting(false);
    }
  }
  if (loading)
    return (
      <main className="page-main">
        <output className="status-message">{webMessages.profileLoading}</output>
      </main>
    );
  if (error || !detail)
    return (
      <main className="page-main">
        <section className="card request-card">
          <p className="error-message" role="alert">
            {webMessages.requestsLoadError}
          </p>
          <button
            className="secondary-button"
            onClick={() => setAttempt((value) => value + 1)}
            type="button"
          >
            {webMessages.retry}
          </button>
        </section>
      </main>
    );
  const estimate = detail.latestEstimate;
  const awaitingApproval =
    detail.request.status === "awaiting_approval" && estimate !== null;
  const insufficient =
    estimate !== null && detail.availableCredits < estimate.credits;
  return (
    <main className="page-main">
      <section className="card request-card" aria-labelledby="my-request-title">
        <Link className="admin-back-link" to="/me/requests">
          {webMessages.myRequestsTitle}
        </Link>
        <h1 id="my-request-title">{detail.request.summary}</h1>
        <dl className="request-summary-list">
          <dt>{webMessages.adminRequestStatus}</dt>
          <dd>{requestStatusLabel(detail.request.status)}</dd>
          <dt>{webMessages.adminRequestReceivedOn}</dt>
          <dd>{detail.request.receivedOn}</dd>
          <dt>{webMessages.myRequestAvailableCredits}</dt>
          <dd>
            {detail.availableCredits} {webMessages.requestCreditUnit}
          </dd>
        </dl>
        {approved ? (
          <output className="notice info">
            {webMessages.myRequestApprovalSuccess}
          </output>
        ) : null}
        {refreshError ? (
          <p className="error-message" role="alert">
            {webMessages.myRequestBalanceRefreshError}
          </p>
        ) : null}
        {actionError === "insufficient" ||
        (awaitingApproval && insufficient) ? (
          <p className="notice info" role="note">
            {webMessages.myRequestInsufficientCredits}
          </p>
        ) : null}
        {actionError === "conflict" ? (
          <p className="error-message" role="alert">
            {webMessages.myRequestConflict}
          </p>
        ) : null}
        {actionError === "generic" ? (
          <p className="error-message" role="alert">
            {webMessages.requestActionError}
          </p>
        ) : null}
        {estimate ? <EstimateDisplay estimate={estimate} /> : null}
        {detail.request.completion ? (
          <>
            <CompletionDisplay
              completion={detail.request.completion}
              customer
            />
            {estimate &&
            detail.request.completion.actualCredits > estimate.credits ? (
              <p className="notice info" role="note">
                {webMessages.adminRequestActualExceedsEstimate}
              </p>
            ) : null}
          </>
        ) : null}
        {awaitingApproval && !detail.canApprove && !insufficient ? (
          <p className="notice info" role="note">
            {webMessages.myRequestConflict}
          </p>
        ) : null}
        {awaitingApproval &&
        (insufficient ||
          actionError === "insufficient" ||
          actionError === "conflict") ? (
          <p className="request-contact-line">
            {webMessages.myRequestContactLine}
          </p>
        ) : null}
        {awaitingApproval &&
        detail.canApprove &&
        !actionError &&
        !approved &&
        !confirming ? (
          <button
            className="primary-button"
            disabled={submitting}
            onClick={() => setConfirming(true)}
            type="button"
          >
            {webMessages.myRequestApprove}
          </button>
        ) : null}
        {confirming ? (
          <section
            className="request-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-confirm-title"
          >
            <h2 id="request-confirm-title">
              {webMessages.myRequestApproveConfirm}
            </h2>
            <div className="admin-actions">
              <button
                className="primary-button"
                disabled={submitting}
                onClick={() => void approve()}
                type="button"
              >
                {submitting
                  ? webMessages.requestSendBusy
                  : webMessages.myRequestApprove}
              </button>
              <button
                className="secondary-button"
                disabled={submitting}
                onClick={() => setConfirming(false)}
                type="button"
              >
                {webMessages.myRequestCancel}
              </button>
            </div>
          </section>
        ) : null}
        {actionError || refreshError ? (
          <button
            className="secondary-button"
            onClick={() => {
              setActionError(null);
              setRefreshError(false);
              setAttempt((value) => value + 1);
            }}
            type="button"
          >
            {webMessages.retry}
          </button>
        ) : null}
      </section>
    </main>
  );
}
