import {
  type AdminRequestDetail,
  type CustomerRequestDetail,
  type CustomerRequestSummary,
  type RequestCompletion,
  webMessages,
} from "@kobito/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ApiClientError,
  type ReturnTypeApiClient,
} from "../platform/api-client.js";
import {
  ContactEmailLink,
  contactMailHref,
  MailText,
  useContact,
} from "../platform/contact.js";
import {
  formatDate,
  formatSlashDate,
  tokyoDateOf,
} from "../platform/format.js";
import {
  BackLink,
  Badge,
  Block,
  Button,
  Card,
  DefinitionList,
  FilterChips,
  Hint,
  Lead,
  ListItem,
  Notice,
  Page,
  StatTiles,
  Title,
} from "../ui/index.js";
import { CustomerTabBar } from "./CustomerTabBar.js";
import {
  requestStatusLabel as customerStatusLabel,
  requestMeta,
  requestPath,
  requestStatusTone,
} from "./request-display.js";

type RequestFilter = "all" | "progress" | "done";
const filterOptions: Array<{ value: RequestFilter; label: string }> = [
  { value: "all", label: webMessages.myRequestsFilterAll },
  { value: "progress", label: webMessages.myRequestsGroupProgress },
  { value: "done", label: webMessages.myRequestsGroupDone },
];

export function MyRequestsPage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  const { contactEmail } = useContact();
  const [items, setItems] = useState<CustomerRequestSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<RequestFilter>("all");
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
  const finished = (items ?? []).filter(
    (item) => item.status === "done" || item.status === "withdrawn",
  );
  const progress = (items ?? []).filter(
    (item) => item.status !== "done" && item.status !== "withdrawn",
  );
  const shownProgress = filter === "done" ? [] : progress;
  const shownDone = filter === "progress" ? [] : finished;
  return (
    <>
      <Page tabbed>
        <Title id="my-requests-title">{webMessages.myRequestsTitle}</Title>
        {items === null && !error ? (
          <output className="ui-lead">{webMessages.profileLoading}</output>
        ) : null}
        {error ? (
          <>
            <Notice tone="warn">{webMessages.requestsLoadError}</Notice>
            <Button
              variant="ghost"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {webMessages.retry}
            </Button>
          </>
        ) : null}
        {items?.length === 0 ? (
          <p className="ui-lead">{webMessages.myRequestsEmpty}</p>
        ) : null}
        {items?.length ? (
          <>
            <FilterChips<RequestFilter>
              label={webMessages.myRequestsFilterLabel}
              onChange={setFilter}
              options={filterOptions}
              value={filter}
            />
            {shownProgress.length > 0 ? (
              <Card title={webMessages.myRequestsGroupProgress}>
                {shownProgress.map((item) => (
                  <RequestRow item={item} key={item.id} />
                ))}
              </Card>
            ) : null}
            {shownDone.length > 0 ? (
              <Card title={webMessages.myRequestsGroupDone}>
                {shownDone.map((item) => (
                  <RequestRow item={item} key={item.id} />
                ))}
              </Card>
            ) : null}
            {shownProgress.length === 0 && shownDone.length === 0 ? (
              <p className="ui-lead">{webMessages.myRequestsFilterEmpty}</p>
            ) : null}
          </>
        ) : null}
        {contactEmail ? (
          <Hint>
            <MailText template={webMessages.myRequestsFooter} />
          </Hint>
        ) : null}
      </Page>
      <CustomerTabBar />
    </>
  );
}

function RequestRow({ item }: { item: CustomerRequestSummary }) {
  const done = item.status === "done" && item.completion;
  return (
    <ListItem
      badge={
        done ? (
          <Badge tone="dark">
            {webMessages.myRequestCreditsUsed.replace(
              "{credits}",
              String(item.completion?.actualCredits ?? 0),
            )}
          </Badge>
        ) : (
          <Badge tone={requestStatusTone(item.status)}>
            {customerStatusLabel(item.status)}
          </Badge>
        )
      }
      component={Link}
      meta={requestMeta(item, true)}
      title={item.summary}
      to={requestPath(item)}
    />
  );
}

export function MyRequestDetailPage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  const { id = "" } = useParams();
  const { lineEnabled, contactEmail } = useContact();
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
      <>
        <Page tabbed>
          <output className="ui-lead">{webMessages.profileLoading}</output>
        </Page>
        <CustomerTabBar />
      </>
    );
  if (error || !detail)
    return (
      <>
        <Page tabbed>
          <BackLink component={Link} to="/me/requests">
            {webMessages.myRequestsTitle}
          </BackLink>
          <Notice tone="warn">{webMessages.requestsLoadError}</Notice>
          <Button
            variant="ghost"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {webMessages.retry}
          </Button>
        </Page>
        <CustomerTabBar />
      </>
    );
  const estimate = detail.latestEstimate;
  const awaitingApproval =
    detail.request.status === "awaiting_approval" && estimate !== null;
  const insufficient =
    estimate !== null && detail.availableCredits < estimate.credits;
  const shortfall = estimate ? estimate.credits - detail.availableCredits : 0;
  const mailHref = contactMailHref(
    contactEmail,
    `${detail.request.summary}について`,
  );
  const showShortfall =
    actionError === "insufficient" || (awaitingApproval && insufficient);
  const completion = detail.request.completion;
  return (
    <>
      <Page tabbed>
        <BackLink component={Link} to="/me/requests">
          {webMessages.myRequestsTitle}
        </BackLink>
        <Title id="my-request-title">
          {awaitingApproval
            ? webMessages.estimateTitle
            : detail.request.summary}
        </Title>
        {awaitingApproval ? <Lead>{webMessages.estimateLead}</Lead> : null}
        {approved ? (
          <Notice tone="info">
            <output>{webMessages.myRequestApprovalSuccess}</output>
          </Notice>
        ) : null}
        {refreshError ? (
          <Notice tone="warn">
            {webMessages.myRequestBalanceRefreshError}
          </Notice>
        ) : null}
        {showShortfall ? (
          <Notice
            tone="warn"
            title={webMessages.myRequestShortfallTitle.replace(
              "{count}",
              String(Math.max(1, shortfall)),
            )}
          >
            {lineEnabled
              ? webMessages.myRequestInsufficientCredits
              : webMessages.myRequestInsufficientCreditsEmail}
          </Notice>
        ) : null}
        {actionError === "conflict" ? (
          <Notice tone="warn">{webMessages.myRequestConflict}</Notice>
        ) : null}
        {actionError === "generic" ? (
          <Notice tone="warn">{webMessages.requestActionError}</Notice>
        ) : null}
        <Card
          title={awaitingApproval ? detail.request.summary : undefined}
          action={
            awaitingApproval ? (
              <Badge tone={requestStatusTone(detail.request.status)}>
                {customerStatusLabel(detail.request.status)}
              </Badge>
            ) : undefined
          }
        >
          {!awaitingApproval ? (
            <DefinitionList
              items={[
                {
                  term: webMessages.adminRequestStatus,
                  description: (
                    <Badge tone={requestStatusTone(detail.request.status)}>
                      {customerStatusLabel(detail.request.status)}
                    </Badge>
                  ),
                },
                {
                  term: webMessages.adminRequestReceivedOn,
                  description: formatDate(detail.request.receivedOn),
                },
              ]}
            />
          ) : null}
          {!estimate && detail.request.status === "received" ? (
            <p className="ui-text">{webMessages.requestDetailQuoting}</p>
          ) : null}
          {estimate ? <EstimateSections estimate={estimate} /> : null}
          {awaitingApproval && estimate ? (
            <>
              {insufficient ? null : (
                <Hint>
                  {webMessages.estimateReserveHint
                    .replace("{credits}", String(estimate.credits))
                    .replace("{before}", String(detail.availableCredits))
                    .replace(
                      "{after}",
                      String(detail.availableCredits - estimate.credits),
                    )}
                </Hint>
              )}
              <Hint>{webMessages.estimateScopeHint}</Hint>
            </>
          ) : null}
          {completion ? <CompletionSummary completion={completion} /> : null}
          {completion &&
          estimate &&
          completion.actualCredits > estimate.credits ? (
            <Notice tone="info">
              {webMessages.adminRequestActualExceedsEstimate}
            </Notice>
          ) : null}
          <DefinitionList
            items={[
              {
                term: webMessages.myRequestAvailableCredits,
                description: `${detail.availableCredits} ${webMessages.requestCreditUnit}`,
              },
            ]}
          />
        </Card>
        {awaitingApproval && !detail.canApprove && !insufficient ? (
          <Notice tone="info">{webMessages.myRequestConflict}</Notice>
        ) : null}
        {awaitingApproval && !confirming && !approved ? (
          <div className="ui-actions">
            <Button
              disabled={
                submitting || !detail.canApprove || Boolean(actionError)
              }
              onClick={() => setConfirming(true)}
            >
              {webMessages.myRequestApprove}
            </Button>
            {mailHref ? (
              <Button href={mailHref} variant="ghost">
                {webMessages.myRequestConsult}
              </Button>
            ) : null}
          </div>
        ) : null}
        {awaitingApproval &&
        (lineEnabled || contactEmail) &&
        (insufficient ||
          actionError === "insufficient" ||
          actionError === "conflict") ? (
          <Hint align="center">
            {lineEnabled ? (
              webMessages.myRequestContactLine
            ) : (
              <ContactEmailLink />
            )}
          </Hint>
        ) : null}
        {confirming ? (
          <section
            className="ui-card ui-card--accent"
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-confirm-title"
          >
            <h2 className="ui-card__title" id="request-confirm-title">
              <span>{webMessages.myRequestApproveConfirm}</span>
            </h2>
            <div className="ui-actions">
              <Button disabled={submitting} onClick={() => void approve()}>
                {submitting
                  ? webMessages.requestSendBusy
                  : webMessages.myRequestApprove}
              </Button>
              <Button
                disabled={submitting}
                onClick={() => setConfirming(false)}
                variant="ghost"
              >
                {webMessages.myRequestCancel}
              </Button>
            </div>
          </section>
        ) : null}
        {actionError || refreshError ? (
          <Button
            variant="ghost"
            onClick={() => {
              setActionError(null);
              setRefreshError(false);
              setAttempt((value) => value + 1);
            }}
          >
            {webMessages.retry}
          </Button>
        ) : null}
        {awaitingApproval && estimate ? (
          <Hint align="center">
            {webMessages.estimateSentOn.replace(
              "{date}",
              formatDate(tokyoDateOf(estimate.sentAt)),
            )}
          </Hint>
        ) : null}
      </Page>
      <CustomerTabBar />
    </>
  );
}

function EstimateSections({
  estimate,
}: {
  estimate: NonNullable<AdminRequestDetail["latestEstimate"]>;
}) {
  return (
    <>
      <Block title={webMessages.estimateWorkItems}>
        <ol>
          {estimate.workItems.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ol>
      </Block>
      <Block title={webMessages.estimateDoneCriteria}>
        <p>{estimate.doneCriteria}</p>
      </Block>
      {estimate.exclusions ? (
        <Block title={webMessages.estimateExclusions}>
          <p>{estimate.exclusions}</p>
        </Block>
      ) : null}
      {estimate.customerPrep ? (
        <Block title={webMessages.estimateCustomerPrep}>
          <p>{estimate.customerPrep}</p>
        </Block>
      ) : null}
      <StatTiles
        items={[
          {
            key: "credits",
            label: webMessages.estimateCreditsUsed,
            value: estimate.credits,
          },
          {
            key: "due",
            label: webMessages.estimateDueTarget,
            value: formatSlashDate(estimate.dueOn),
            tone: "gray",
          },
        ]}
      />
    </>
  );
}

function CompletionSummary({ completion }: { completion: RequestCompletion }) {
  return (
    <DefinitionList
      items={[
        {
          term: webMessages.myRequestCompletionDate,
          description: formatDate(completion.completedOn),
        },
        {
          term: webMessages.myRequestCompletionActualCredits,
          description: `${completion.actualCredits} ${webMessages.requestCreditUnit}`,
        },
      ]}
    />
  );
}
