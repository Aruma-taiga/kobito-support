import {
  type CustomerContractResponse,
  type CustomerRequestSummary,
  contractStatusLabels,
  inclYenFor,
  type MeResponse,
  taxOnExcl,
  webMessages,
} from "@kobito/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthSession } from "../auth/session.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";
import { ApiClientError } from "../platform/api-client.js";
import { contactMailHref, useContact } from "../platform/contact.js";
import { dayAfter, formatMonthDay, formatYen } from "../platform/format.js";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  CreditRing,
  DefinitionList,
  Hint,
  ListItem,
  Notice,
  Page,
} from "../ui/index.js";
import { CustomerTabBar } from "./CustomerTabBar.js";
import {
  requestMeta,
  requestPath,
  requestStatusLabel,
  requestStatusTone,
} from "./request-display.js";

type PageState =
  | { status: "loading"; attempt: number }
  | { status: "ready"; data: MeResponse }
  | { status: "error"; reason: "profile" | "session" };

type Contract = NonNullable<CustomerContractResponse["contract"]>;

export function MePage({
  apiClient,
  showAccountLinks = true,
  showContractAccess = true,
}: {
  apiClient: ReturnTypeApiClient;
  showAccountLinks?: boolean;
  showContractAccess?: boolean;
}) {
  const { signOut } = useAuthSession();
  const { contactEmail } = useContact();
  const [state, setState] = useState<PageState>({
    status: "loading",
    attempt: 0,
  });
  const [attempt, setAttempt] = useState(0);
  const [logoutError, setLogoutError] = useState(false);
  const [contract, setContract] = useState<CustomerContractResponse | null>(
    null,
  );
  const [contractError, setContractError] = useState(false);
  const [requests, setRequests] = useState<CustomerRequestSummary[] | null>(
    null,
  );
  const [requestsError, setRequestsError] = useState(false);

  useEffect(() => {
    let current = true;
    setState({ status: "loading", attempt });
    void apiClient
      .getMe()
      .then((data) => {
        if (current) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (error instanceof ApiClientError && error.code === "unauthorized") {
          setState({ status: "error", reason: "session" });
          return;
        }
        setState({ status: "error", reason: "profile" });
      });
    if (showContractAccess) {
      void apiClient
        .getContract()
        .then((value) => {
          if (current) {
            setContract(value);
            setContractError(false);
          }
        })
        .catch(() => {
          if (current) setContractError(true);
        });
    } else {
      setContract(null);
      setContractError(false);
    }
    if (showAccountLinks) {
      void apiClient
        .getCustomerRequests()
        .then(({ items }) => {
          if (current) {
            setRequests(items);
            setRequestsError(false);
          }
        })
        .catch(() => {
          if (current) setRequestsError(true);
        });
    } else {
      setRequests(null);
      setRequestsError(false);
    }
    return () => {
      current = false;
    };
  }, [apiClient, attempt, showContractAccess, showAccountLinks]);

  async function handleSignOut() {
    setLogoutError(false);
    try {
      await signOut();
    } catch {
      setLogoutError(true);
    }
  }

  const running = (requests ?? []).filter(
    (item) => item.status !== "done" && item.status !== "withdrawn",
  );
  const awaitingApproval = running.find(
    (item) => item.status === "awaiting_approval" && item.latestEstimate,
  );
  const mailHref = contactMailHref(contactEmail);
  const detail = contract?.contract ?? null;

  return (
    <>
      <Page tabbed={state.status === "ready" && showAccountLinks}>
        <h1 className="visually-hidden">{webMessages.homeTitle}</h1>
        {state.status === "loading" ? (
          <output className="ui-lead">{webMessages.profileLoading}</output>
        ) : null}
        {state.status === "error" ? (
          <>
            <Notice tone="warn">
              {state.reason === "session"
                ? webMessages.sessionExpiredError
                : webMessages.profileError}
            </Notice>
            {state.reason === "profile" ? (
              <Button
                variant="ghost"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {webMessages.retry}
              </Button>
            ) : null}
          </>
        ) : null}
        {state.status === "ready" ? (
          <>
            <p className="ui-who">
              <span>{state.data.customer.shopName}</span> 様
            </p>
            {awaitingApproval?.latestEstimate ? (
              <Notice tone="yellow">
                <div className="ui-notice__row">
                  <span>
                    <b className="ui-notice__title">
                      {webMessages.homeEstimateArrived}
                    </b>
                    {awaitingApproval.summary}（
                    {awaitingApproval.latestEstimate.credits}
                    {webMessages.requestCreditUnit}）
                  </span>
                  <Link
                    className={buttonClass("primary", { size: "sm" })}
                    to={`/me/requests/${encodeURIComponent(awaitingApproval.id)}/estimate`}
                  >
                    {webMessages.homeEstimateOpen}
                  </Link>
                </div>
              </Notice>
            ) : null}
            <CreditsCard
              contract={detail}
              error={contractError}
              loading={showContractAccess && !contractError && !contract}
              none={
                !showContractAccess ||
                (!contractError && contract?.contract === null)
              }
            />
            {showAccountLinks ? (
              <Card
                title={webMessages.myRequestsTitle}
                action={
                  <Link to="/me/requests">{webMessages.homeRequestsAll}</Link>
                }
              >
                {requestsError ? (
                  <p className="ui-text">{webMessages.requestsLoadError}</p>
                ) : null}
                {!requestsError && requests !== null && running.length === 0 ? (
                  <p className="ui-text">{webMessages.homeRequestsEmpty}</p>
                ) : null}
                {running.slice(0, 3).map((item) => (
                  <ListItem
                    badge={
                      <Badge tone={requestStatusTone(item.status)}>
                        {requestStatusLabel(item.status)}
                      </Badge>
                    }
                    component={Link}
                    key={item.id}
                    meta={requestMeta(item)}
                    title={item.summary}
                    to={requestPath(item)}
                  />
                ))}
              </Card>
            ) : null}
            {showAccountLinks && detail ? (
              <NextPaymentCard contract={detail} />
            ) : null}
            {showAccountLinks && mailHref ? (
              <div className="ui-actions">
                <Button href={mailHref} variant="dark">
                  {webMessages.homeContactButton}
                </Button>
                <Hint align="center">{contactEmail}</Hint>
              </div>
            ) : null}
            {detail?.preview ? (
              <Notice tone="yellow">{webMessages.contractPreview}</Notice>
            ) : null}
          </>
        ) : null}
        {state.status === "error" || !showAccountLinks ? (
          <div className="ui-actions">
            {logoutError ? (
              <Notice tone="warn">{webMessages.logoutError}</Notice>
            ) : null}
            <Button variant="ghost" onClick={() => void handleSignOut()}>
              {webMessages.logout}
            </Button>
          </div>
        ) : null}
      </Page>
      {state.status === "ready" && showAccountLinks ? <CustomerTabBar /> : null}
    </>
  );
}

function CreditsCard({
  contract,
  error,
  loading,
  none,
}: {
  contract: Contract | null;
  error: boolean;
  loading: boolean;
  none: boolean;
}) {
  const period = contract?.currentPeriod ?? null;
  return (
    <Card
      title={webMessages.homeCreditsTitle}
      action={
        contract ? (
          <Badge tone={contract.status === "active" ? "sage" : "yellow"}>
            {contractStatusLabels[contract.status]}
          </Badge>
        ) : undefined
      }
    >
      {error ? (
        <Notice tone="warn">{webMessages.contractLoadError}</Notice>
      ) : null}
      {loading ? (
        <output className="ui-text">{webMessages.contractLoading}</output>
      ) : null}
      {none ? <p className="ui-text">{webMessages.contractNone}</p> : null}
      {contract && !period ? (
        <p className="ui-text">{webMessages.contractNoCredits}</p>
      ) : null}
      {period ? (
        <>
          <div className="ui-credit">
            <CreditRing remaining={period.balance} total={period.credits} />
            <DefinitionList
              items={[
                {
                  term: webMessages.homeCreditsGranted,
                  description: period.credits,
                },
                {
                  term: webMessages.homeCreditsExpiry,
                  description: formatMonthDay(period.endsOn),
                },
              ]}
            />
          </div>
          <Hint>{webMessages.homeCreditsNote}</Hint>
        </>
      ) : null}
    </Card>
  );
}

function NextPaymentCard({ contract }: { contract: Contract }) {
  const period = contract.currentPeriod;
  if (!period) return null;
  return (
    <Card
      title={webMessages.homeNextPaymentTitle}
      action={<Link to="/me/invoices">{webMessages.homeNextPaymentLink}</Link>}
    >
      {contract.status === "cancel_scheduled" || !contract.plan ? (
        <p className="ui-text">
          {webMessages.homeCancelScheduled.replace(
            "{date}",
            formatMonthDay(period.endsOn),
          )}
        </p>
      ) : (
        <>
          <DefinitionList
            items={[
              {
                term: webMessages.homeNextBillingDate,
                description: formatMonthDay(dayAfter(period.endsOn)),
              },
              {
                term: webMessages.homeNextBillingAmount,
                description: formatYen(inclYenFor(contract.plan.priceExclTax)),
              },
            ]}
          />
          <Hint align="right">
            {webMessages.homeNextBillingBreakdown
              .replace(
                "{excl}",
                contract.plan.priceExclTax.toLocaleString("ja-JP"),
              )
              .replace(
                "{tax}",
                taxOnExcl(contract.plan.priceExclTax).toLocaleString("ja-JP"),
              )}
          </Hint>
        </>
      )}
    </Card>
  );
}
