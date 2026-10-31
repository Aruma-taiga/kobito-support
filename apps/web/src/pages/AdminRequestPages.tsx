import {
  type AdminRequestDetail,
  type AdminRequestSummary,
  type CompleteRequest,
  type CreateEstimate,
  type CreateRequest,
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
import { formatSlashDate } from "../platform/format.js";
import {
  ActionBar,
  AdminColumns,
  AdminHeading,
  Badge,
  type BadgeTone,
  Button,
  buttonClass,
  Card,
  CheckOption,
  DefinitionList,
  Field,
  FilterChips,
  Hint,
  Notice,
  Table,
} from "../ui/index.js";

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

function requestStatusTone(status: RequestStatus): BadgeTone {
  switch (status) {
    case "awaiting_approval":
      return "yellow";
    case "in_progress":
      return "sage";
    case "done":
      return "dark";
    default:
      return "gray";
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

type ListFilter = "progress" | RequestStatus;
const filterOptions: Array<{ value: ListFilter; label: string }> = [
  { value: "progress", label: webMessages.adminRequestsFilterProgress },
  { value: "received", label: requestStatusLabel("received") },
  {
    value: "awaiting_approval",
    label: requestStatusLabel("awaiting_approval"),
  },
  { value: "in_progress", label: requestStatusLabel("in_progress") },
  { value: "done", label: requestStatusLabel("done") },
];

function matchesFilter(status: RequestStatus, filter: ListFilter): boolean {
  if (filter === "progress") {
    return (
      status === "received" ||
      status === "awaiting_approval" ||
      status === "in_progress"
    );
  }
  return status === filter;
}

export function AdminRequestListPage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  const [items, setItems] = useState<AdminRequestSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<ListFilter>("progress");
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
  const shown = (items ?? []).filter((item) =>
    matchesFilter(item.status, filter),
  );
  return (
    <>
      <AdminHeading
        id="admin-requests-title"
        title={webMessages.adminRequestsTitle}
        actions={
          <Link
            className={buttonClass("primary", { size: "sm" })}
            to="/admin/requests/new"
          >
            <span aria-hidden="true">＋ </span>
            {webMessages.adminRequestsNew}
          </Link>
        }
      />
      <FilterChips
        label={webMessages.adminStatusFilterLabel}
        options={filterOptions}
        value={filter}
        onChange={(value) => setFilter(value)}
      />
      {items === null && !error ? (
        <output className="ui-admin__lead">
          {webMessages.adminQueueLoading}
        </output>
      ) : null}
      {error ? (
        <>
          <Notice tone="warn">{webMessages.requestsLoadError}</Notice>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {webMessages.retry}
          </Button>
        </>
      ) : null}
      {items && shown.length === 0 ? (
        <Hint>{webMessages.myRequestsEmpty}</Hint>
      ) : null}
      {shown.length ? (
        <Table
          caption={webMessages.adminRequestsTableLabel}
          highlightRows={shown.flatMap((item, index) =>
            item.status === "received" ? [index] : [],
          )}
          columns={[
            { key: "received", header: webMessages.adminRequestColReceived },
            { key: "summary", header: webMessages.adminRequestColSummary },
            { key: "status", header: webMessages.adminRequestColStatus },
            {
              key: "credits",
              header: webMessages.adminRequestColCredits,
              numeric: true,
            },
            { key: "due", header: webMessages.adminRequestColDue },
          ]}
          rows={shown.map((item) => {
            const credits =
              item.completion?.actualCredits ??
              item.latestEstimate?.credits ??
              null;
            return {
              received: formatSlashDate(item.receivedOn),
              summary: (
                <>
                  <Link to={`/admin/requests/${encodeURIComponent(item.id)}`}>
                    <b>{item.summary}</b>
                  </Link>{" "}
                  {item.urgent ? (
                    <Badge tone="warn">{webMessages.adminRequestUrgent}</Badge>
                  ) : null}
                </>
              ),
              status: (
                <Badge tone={requestStatusTone(item.status)}>
                  {requestStatusLabel(item.status)}
                </Badge>
              ),
              credits: credits ?? "—",
              due: item.latestEstimate
                ? formatSlashDate(item.latestEstimate.dueOn)
                : "—",
            };
          })}
        />
      ) : null}
    </>
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
    <>
      <AdminHeading
        id="new-request-title"
        crumb={
          <>
            <Link to="/admin/requests">{webMessages.adminRequestsTitle}</Link> ›
          </>
        }
        title={webMessages.adminRequestsNew}
      />
      <p className="ui-admin__lead">{webMessages.adminRequestNewDescription}</p>
      {loadError ? (
        <Notice tone="warn">{webMessages.requestsLoadError}</Notice>
      ) : null}
      {loading ? (
        <output className="ui-admin__lead">
          {webMessages.adminQueueLoading}
        </output>
      ) : null}
      {!loading && !loadError && contracts.length === 0 ? (
        <Hint>{webMessages.adminRequestNoEligibleContract}</Hint>
      ) : null}
      {!loading && !loadError && contracts.length > 0 ? (
        <Card>
          <form noValidate onSubmit={(event) => void submit(event)}>
            <Field label={webMessages.adminRequestCustomer}>
              <select
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
            </Field>
            <Field label={webMessages.adminRequestReceivedOn}>
              <input
                required
                type="date"
                value={receivedOn}
                onChange={(event) => setReceivedOn(event.currentTarget.value)}
              />
            </Field>
            <Field label={webMessages.adminRequestSummary}>
              <textarea
                maxLength={500}
                required
                value={summary}
                onChange={(event) => setSummary(event.currentTarget.value)}
              />
            </Field>
            <CheckOption
              checked={urgent}
              onChange={(event) => setUrgent(event.currentTarget.checked)}
            >
              {webMessages.adminRequestUrgent}
            </CheckOption>
            {error ? <Notice tone="warn">{error}</Notice> : null}
            <ActionBar>
              <Button size="sm" disabled={submitting} type="submit">
                {submitting
                  ? webMessages.requestSendBusy
                  : webMessages.adminRequestsCreate}
              </Button>
            </ActionBar>
          </form>
        </Card>
      ) : null}
    </>
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
  onCancel,
}: {
  apiClient: AdminApiClient;
  requestId: string;
  initial: EstimateDraft | undefined;
  onSent: () => Promise<void>;
  onCancel?: (() => void) | undefined;
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
    <form noValidate onSubmit={(event) => void submit(event)}>
      <Field
        label={`${webMessages.adminEstimateWorkItems}（${webMessages.adminEstimateWorkItemsHint}）`}
        required
      >
        <textarea
          required
          value={workItems}
          onChange={(event) => setWorkItems(event.currentTarget.value)}
        />
      </Field>
      <Field label={webMessages.adminEstimateDoneCriteria} required>
        <input
          required
          value={doneCriteria}
          onChange={(event) => setDoneCriteria(event.currentTarget.value)}
        />
      </Field>
      <Field label={webMessages.adminEstimateExclusions} optional>
        <input
          value={exclusions}
          onChange={(event) => setExclusions(event.currentTarget.value)}
        />
      </Field>
      <Field label={webMessages.adminEstimateCustomerPrep} optional>
        <input
          value={customerPrep}
          onChange={(event) => setCustomerPrep(event.currentTarget.value)}
        />
      </Field>
      <div className="ui-row2">
        <Field label={webMessages.adminEstimateCredits}>
          <input
            min="1"
            max="1000"
            required
            type="number"
            value={credits}
            onChange={(event) => setCredits(event.currentTarget.value)}
          />
        </Field>
        <Field label={webMessages.adminEstimateDueOn}>
          <input
            required
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.currentTarget.value)}
          />
        </Field>
      </div>
      {error ? (
        <Notice tone="warn">
          {error === "validation"
            ? webMessages.requestValidationError
            : error === "conflict"
              ? webMessages.myRequestConflict
              : webMessages.requestActionError}
        </Notice>
      ) : null}
      <ActionBar>
        <Button size="sm" disabled={submitting} type="submit">
          {submitting
            ? webMessages.requestSendBusy
            : initial
              ? webMessages.adminEstimateRevise
              : webMessages.adminEstimateSend}
        </Button>
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {webMessages.myRequestCancel}
          </Button>
        ) : null}
      </ActionBar>
    </form>
  );
}

function EstimateDisplay({
  estimate,
}: {
  estimate: NonNullable<AdminRequestDetail["latestEstimate"]>;
}) {
  return (
    <Card
      title={`${webMessages.myRequestEstimateTitle}（${webMessages.estimateVersion} ${estimate.version}）`}
    >
      <DefinitionList
        items={[
          {
            term: webMessages.estimateCredits,
            description: `${estimate.credits} ${webMessages.requestCreditUnit}`,
          },
          { term: webMessages.estimateDueOn, description: estimate.dueOn },
          {
            term: webMessages.estimateWorkItems,
            description: (
              <ul>
                {estimate.workItems.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            ),
          },
          {
            term: webMessages.estimateDoneCriteria,
            description: estimate.doneCriteria,
          },
          ...(estimate.exclusions
            ? [
                {
                  term: webMessages.estimateExclusions,
                  description: estimate.exclusions,
                },
              ]
            : []),
          ...(estimate.customerPrep
            ? [
                {
                  term: webMessages.estimateCustomerPrep,
                  description: estimate.customerPrep,
                },
              ]
            : []),
        ]}
      />
    </Card>
  );
}

function CompletionDisplay({ completion }: { completion: RequestCompletion }) {
  return (
    <Card title={webMessages.requestStatusDone}>
      <DefinitionList
        items={[
          {
            term: webMessages.adminRequestCompletedOn,
            description: completion.completedOn,
          },
          {
            term: webMessages.adminRequestActualMinutes,
            description: `${completion.actualMinutes} ${webMessages.requestMinuteUnit}`,
          },
          {
            term: webMessages.adminRequestActualCredits,
            description: `${completion.actualCredits} ${webMessages.requestCreditUnit}`,
          },
          {
            term: webMessages.adminRequestReservedPeriod,
            description: `${completion.reservedPeriod.startsOn}〜${completion.reservedPeriod.endsOn}`,
          },
          {
            term: webMessages.adminRequestReservedCredits,
            description: `${completion.reservedCredits} ${webMessages.requestCreditUnit}`,
          },
        ]}
      />
    </Card>
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
      <output className="ui-admin__lead">
        {webMessages.adminQueueLoading}
      </output>
    );
  if (error || !detail)
    return (
      <>
        <AdminHeading title={webMessages.adminRequestsTitle} />
        <Notice tone="warn">{webMessages.requestsLoadError}</Notice>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAttempt((value) => value + 1)}
        >
          {webMessages.retry}
        </Button>
      </>
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
  const showEstimateForm =
    !refreshError && canSend && (!detail.latestEstimate || revise);
  return (
    <>
      <AdminHeading
        id="request-detail-title"
        crumb={
          <>
            <Link to="/admin/requests">{webMessages.adminRequestsTitle}</Link> ›
          </>
        }
        title={detail.summary}
        badge={
          <>
            <Badge tone={requestStatusTone(detail.status)}>
              {requestStatusLabel(detail.status)}
            </Badge>
            {detail.urgent ? (
              <>
                {" "}
                <Badge tone="warn">{webMessages.adminRequestUrgent}</Badge>
              </>
            ) : null}
          </>
        }
      />
      <AdminColumns>
        <div>
          <Card>
            <DefinitionList
              items={[
                {
                  term: webMessages.adminRequestCustomer,
                  description: `${detail.customer.shopName}（${detail.customer.contactName}）`,
                },
                {
                  term: webMessages.adminRequestReceivedOn,
                  description: detail.receivedOn,
                },
                {
                  term: webMessages.adminRequestStatus,
                  description: requestStatusLabel(detail.status),
                },
              ]}
            />
          </Card>
          {detail.estimates.map((item) => (
            <EstimateDisplay key={item.id} estimate={item} />
          ))}
          {detail.completion ? (
            <CompletionDisplay completion={detail.completion} />
          ) : null}
        </div>
        <div>
          {completionSucceeded ? (
            <Notice live>{webMessages.adminRequestCompletionSuccess}</Notice>
          ) : null}
          {completionExceedsEstimate ? (
            <Notice tone="yellow">
              {webMessages.adminRequestActualExceedsEstimate}
            </Notice>
          ) : null}
          {completionError === "conflict" ? (
            <Notice tone="warn">
              {webMessages.adminRequestCompletionConflict}
            </Notice>
          ) : null}
          {completionError === "validation" && !canComplete ? (
            <Notice tone="warn">
              {webMessages.adminRequestCompletionValidation}
            </Notice>
          ) : null}
          {completionError === "action" && !confirmingCompletion ? (
            <Notice tone="warn">{webMessages.requestActionError}</Notice>
          ) : null}
          {completionRefreshError ? (
            <Notice tone="warn">{webMessages.requestsLoadError}</Notice>
          ) : null}
          {completionError === "conflict" || completionRefreshError ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCompletionError(null);
                setCompletionRefreshError(false);
                setAttempt((value) => value + 1);
              }}
            >
              {webMessages.retry}
            </Button>
          ) : null}
          {refreshError ? (
            <>
              <Notice tone="warn">
                {webMessages.adminEstimateSentRefreshError}
              </Notice>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {webMessages.retry}
              </Button>
            </>
          ) : null}
          {showEstimateForm ? (
            <Card
              title={
                revise
                  ? webMessages.adminEstimateRevise
                  : webMessages.adminRequestEstimate
              }
            >
              <EstimateForm
                apiClient={apiClient}
                requestId={id}
                initial={
                  revise && detail.latestEstimate
                    ? detail.latestEstimate
                    : undefined
                }
                onCancel={
                  detail.latestEstimate && revise
                    ? () => setRevise(false)
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
              <Hint>{webMessages.adminEstimateCompleteNote}</Hint>
            </Card>
          ) : null}
          {!refreshError && canSend && detail.latestEstimate && !revise ? (
            <Card>
              <Hint>{webMessages.adminEstimateCompleteNote}</Hint>
              <ActionBar>
                <Button size="sm" onClick={() => setRevise(true)}>
                  {webMessages.adminEstimateRevise}
                </Button>
              </ActionBar>
            </Card>
          ) : null}
          {canComplete ? (
            <Card title={webMessages.adminRequestComplete}>
              <form noValidate onSubmit={prepareCompletion}>
                <Field label={webMessages.adminRequestCompletedOn}>
                  <input
                    type="date"
                    required
                    min={detail.receivedOn}
                    max={tokyoToday()}
                    value={completedOn}
                    disabled={confirmingCompletion || completing}
                    onChange={(event) =>
                      setCompletedOn(event.currentTarget.value)
                    }
                  />
                </Field>
                <div className="ui-row2">
                  <Field label={webMessages.adminRequestActualMinutes}>
                    <input
                      type="number"
                      min="0"
                      max="2147483647"
                      step="1"
                      required
                      value={actualMinutes}
                      disabled={confirmingCompletion || completing}
                      onChange={(event) =>
                        setActualMinutes(event.currentTarget.value)
                      }
                    />
                  </Field>
                  <Field label={webMessages.adminRequestActualCredits}>
                    <input
                      type="number"
                      min="0"
                      max="2147483647"
                      step="1"
                      required
                      value={actualCredits}
                      disabled={confirmingCompletion || completing}
                      onChange={(event) =>
                        setActualCredits(event.currentTarget.value)
                      }
                    />
                  </Field>
                </div>
                {completionError === "validation" ? (
                  <Notice tone="warn">
                    {webMessages.adminRequestCompletionValidation}
                  </Notice>
                ) : null}
                <ActionBar>
                  <Button
                    size="sm"
                    type="submit"
                    disabled={confirmingCompletion || completing}
                  >
                    {webMessages.adminRequestComplete}
                  </Button>
                </ActionBar>
              </form>
            </Card>
          ) : null}
          {confirmingCompletion && completionDraft ? (
            <section
              className="ui-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="request-completion-confirm-title"
            >
              <h3
                className="ui-card__title"
                id="request-completion-confirm-title"
              >
                {webMessages.adminRequestCompletionConfirm}
              </h3>
              <DefinitionList
                items={[
                  {
                    term: webMessages.adminRequestSummary,
                    description: detail.summary,
                  },
                  {
                    term: webMessages.adminRequestCustomer,
                    description: `${detail.customer.shopName}（${detail.customer.contactName}）`,
                  },
                  ...(detail.latestEstimate
                    ? [
                        {
                          term: webMessages.adminEstimateCredits,
                          description: `${detail.latestEstimate.credits} ${webMessages.requestCreditUnit}`,
                        },
                      ]
                    : []),
                  {
                    term: webMessages.adminRequestCompletedOn,
                    description: completionDraft.completedOn,
                  },
                  {
                    term: webMessages.adminRequestActualMinutes,
                    description: `${completionDraft.actualMinutes} ${webMessages.requestMinuteUnit}`,
                  },
                  {
                    term: webMessages.adminRequestActualCredits,
                    description: `${completionDraft.actualCredits} ${webMessages.requestCreditUnit}`,
                  },
                ]}
              />
              {detail.latestEstimate &&
              completionDraft.actualCredits > detail.latestEstimate.credits ? (
                <Notice tone="yellow">
                  {webMessages.adminRequestActualExceedsEstimate}
                </Notice>
              ) : null}
              {completionError === "action" ? (
                <Notice tone="warn">{webMessages.requestActionError}</Notice>
              ) : null}
              <ActionBar>
                <Button
                  size="sm"
                  disabled={completing}
                  onClick={() => void complete()}
                >
                  {completing
                    ? webMessages.requestSendBusy
                    : webMessages.adminRequestComplete}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={completing}
                  onClick={() => {
                    setConfirmingCompletion(false);
                    setCompletionError(null);
                  }}
                >
                  {webMessages.myRequestCancel}
                </Button>
              </ActionBar>
            </section>
          ) : null}
        </div>
      </AdminColumns>
    </>
  );
}
