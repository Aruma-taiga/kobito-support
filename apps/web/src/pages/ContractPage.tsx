import { contractStatusLabels, inclYenFor, webMessages } from "@kobito/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthSession } from "../auth/session.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";
import { ApiClientError } from "../platform/api-client.js";
import { contactMailHref, MailText, useContact } from "../platform/contact.js";
import {
  dayAfter,
  formatDate,
  formatMonthDay,
  formatYen,
} from "../platform/format.js";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  DefinitionList,
  Hint,
  Notice,
  Page,
  Title,
} from "../ui/index.js";
import { CustomerTabBar } from "./CustomerTabBar.js";

type ContractPageState =
  | { status: "loading" }
  | {
      status: "ready";
      data: Awaited<ReturnType<ReturnTypeApiClient["getContract"]>>;
    }
  | { status: "error"; reason: "contract" | "session" };

export function ContractPage({
  apiClient,
  lineLiffId,
}: {
  apiClient: ReturnTypeApiClient;
  lineLiffId?: string | undefined;
}) {
  const {
    state: session,
    sessionGeneration,
    getSessionGeneration,
    signOut,
  } = useAuthSession();
  const { lineEnabled, contactEmail } = useContact();
  const [state, setState] = useState<ContractPageState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [logoutError, setLogoutError] = useState(false);
  const [lineLinked, setLineLinked] = useState<
    "loading" | "linked" | "unlinked" | "error"
  >("loading");
  const [lineAttempt, setLineAttempt] = useState(0);
  const lineStatusUserId =
    session.status === "authenticated" ? session.user.uid : null;

  // attempt intentionally retriggers this request after a customer retry.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is a refetch trigger
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    void apiClient
      .getContract()
      .then((data) => {
        if (current) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!current) return;
        setState({
          status: "error",
          reason:
            error instanceof ApiClientError && error.code === "unauthorized"
              ? "session"
              : "contract",
        });
      });
    return () => {
      current = false;
    };
  }, [apiClient, attempt]);

  // lineAttempt intentionally retriggers the LINE status request after retry.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lineAttempt is a refetch trigger
  useEffect(() => {
    let current = true;
    const requestGeneration = getSessionGeneration();
    if (lineEnabled && lineLiffId && lineStatusUserId) {
      setLineLinked("loading");
      void apiClient.getLineLinkStatus(lineStatusUserId).then(
        ({ linked }) => {
          if (current && getSessionGeneration() === requestGeneration)
            setLineLinked(linked ? "linked" : "unlinked");
        },
        () => {
          if (current && getSessionGeneration() === requestGeneration)
            setLineLinked("error");
        },
      );
    }
    return () => {
      current = false;
    };
  }, [
    apiClient,
    getSessionGeneration,
    lineAttempt,
    lineEnabled,
    lineLiffId,
    lineStatusUserId,
    sessionGeneration,
  ]);

  async function handleSignOut() {
    setLogoutError(false);
    try {
      await signOut();
    } catch {
      setLogoutError(true);
    }
  }

  const contract = state.status === "ready" ? state.data.contract : null;
  const period = contract?.currentPeriod ?? null;
  const plan = contract?.plan ?? null;
  const mailHref = contactMailHref(contactEmail);
  const planRows = [
    ...(plan
      ? [
          {
            term: webMessages.contractMonthlyExcl,
            description: formatYen(plan.priceExclTax),
          },
          {
            term: webMessages.contractMonthlyIncl,
            description: formatYen(inclYenFor(plan.priceExclTax)),
          },
          {
            term: webMessages.contractMonthlyCredits,
            description: plan.credits,
          },
        ]
      : [
          {
            term: webMessages.contractPlan,
            description: webMessages.contractWaitingPayment,
          },
        ]),
    {
      term: webMessages.contractDate,
      description: contract?.anchorDate
        ? formatDate(contract.anchorDate)
        : webMessages.contractWaitingPayment,
    },
    {
      term: webMessages.contractPeriod,
      description: period ? (
        <span>
          <time className="ui-nowrap" dateTime={period.startsOn}>
            {formatDate(period.startsOn)}
          </time>
          〜
          <time className="ui-nowrap" dateTime={period.endsOn}>
            {formatDate(period.endsOn)}
          </time>
        </span>
      ) : (
        webMessages.contractCurrentPeriodUnavailable
      ),
    },
    {
      term: webMessages.contractNextBilling,
      description:
        period && contract?.status === "active"
          ? formatDate(dayAfter(period.endsOn))
          : "―",
    },
    {
      term: webMessages.contractCredits,
      description: period
        ? `${period.balance} ${webMessages.contractBalanceUnit}`
        : webMessages.contractCurrentBalanceUnavailable,
    },
  ];

  return (
    <>
      <Page tabbed>
        <Title id="contract-title">{webMessages.contractTitle}</Title>
        {state.status === "loading" ? (
          <output className="ui-lead">{webMessages.contractLoading}</output>
        ) : null}
        {state.status === "error" ? (
          <>
            <Notice tone="warn">
              {state.reason === "session"
                ? webMessages.sessionExpiredError
                : webMessages.contractLoadError}
            </Notice>
            {state.reason === "contract" ? (
              <Button
                variant="ghost"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {webMessages.retry}
              </Button>
            ) : null}
          </>
        ) : null}
        {state.status === "ready" && !contract ? (
          <p className="ui-lead">{webMessages.contractNone}</p>
        ) : null}
        {contract ? (
          <>
            <Card
              title={plan?.name ?? webMessages.contractPlan}
              action={
                <Badge tone={contract.status === "active" ? "sage" : "yellow"}>
                  {contractStatusLabels[contract.status]}
                </Badge>
              }
            >
              <DefinitionList items={planRows} />
            </Card>
            {contract.preview ? (
              <Notice tone="yellow">{webMessages.contractPreview}</Notice>
            ) : null}
            {lineEnabled && lineLiffId ? (
              <Card title={webMessages.lineLogin}>
                {lineLinked === "linked" ? (
                  <p className="ui-text">{webMessages.lineLinked}</p>
                ) : null}
                {lineLinked === "unlinked" ? (
                  <Link className={buttonClass("ghost")} to="/liff?to=home">
                    {webMessages.lineLink}
                  </Link>
                ) : null}
                {lineLinked === "loading" ? (
                  <output className="ui-text">{webMessages.lineLoading}</output>
                ) : null}
                {lineLinked === "error" ? (
                  <>
                    <Notice tone="warn">{webMessages.lineUnavailable}</Notice>
                    <Button
                      variant="ghost"
                      onClick={() => setLineAttempt((value) => value + 1)}
                    >
                      {webMessages.lineRetry}
                    </Button>
                  </>
                ) : null}
              </Card>
            ) : null}
            <Card title={webMessages.contractLoginHeading}>
              <DefinitionList
                items={[
                  {
                    term: webMessages.contractEmailLabel,
                    description: session.user?.email ?? "―",
                  },
                ]}
              />
              {logoutError ? (
                <Notice tone="warn">{webMessages.logoutError}</Notice>
              ) : null}
              <div className="ui-actions">
                <Button variant="ghost" onClick={() => void handleSignOut()}>
                  {webMessages.logout}
                </Button>
              </div>
            </Card>
            <Card title={webMessages.contractPlanChangeHeading}>
              <p className="ui-text">
                {lineEnabled ? (
                  webMessages.contractPlanChangeGuidance
                ) : (
                  <MailText template={webMessages.contractPlanChangeBody} />
                )}
              </p>
              {mailHref ? (
                <div className="ui-actions">
                  <Button href={mailHref} variant="dark">
                    {webMessages.contractMailButton}
                  </Button>
                </div>
              ) : null}
              {period ? (
                <Hint>
                  {webMessages.contractCancelNote.replace(
                    "{date}",
                    formatMonthDay(period.endsOn),
                  )}
                </Hint>
              ) : null}
            </Card>
          </>
        ) : null}
        {state.status === "error" ? (
          <div className="ui-actions">
            <Button variant="ghost" onClick={() => void handleSignOut()}>
              {webMessages.logout}
            </Button>
          </div>
        ) : null}
      </Page>
      <CustomerTabBar />
    </>
  );
}
