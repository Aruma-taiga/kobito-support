import { contractStatusLabels, webMessages } from "@kobito/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthSession } from "../auth/session.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";
import { ApiClientError } from "../platform/api-client.js";

type ContractPageState =
  | { status: "loading" }
  | {
      status: "ready";
      data: Awaited<ReturnType<ReturnTypeApiClient["getContract"]>>;
    }
  | { status: "error"; reason: "contract" | "session" };

export function ContractPage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  const { signOut } = useAuthSession();
  const [state, setState] = useState<ContractPageState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [logoutError, setLogoutError] = useState(false);

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

  async function handleSignOut() {
    setLogoutError(false);
    try {
      await signOut();
    } catch {
      setLogoutError(true);
    }
  }

  const contract = state.status === "ready" ? state.data.contract : null;

  return (
    <main className="page-main">
      <section className="card profile-card" aria-labelledby="contract-title">
        <h1 id="contract-title">{webMessages.contractTitle}</h1>
        {state.status === "loading" ? (
          <output className="status-message">
            {webMessages.contractLoading}
          </output>
        ) : null}
        {state.status === "error" ? (
          <div>
            <p className="error-message" role="alert">
              {state.reason === "session"
                ? webMessages.sessionExpiredError
                : webMessages.contractLoadError}
            </p>
            {state.reason === "contract" ? (
              <button
                className="secondary-button"
                onClick={() => setAttempt((value) => value + 1)}
                type="button"
              >
                {webMessages.retry}
              </button>
            ) : null}
          </div>
        ) : null}
        {state.status === "ready" && !contract ? (
          <p>{webMessages.contractNone}</p>
        ) : null}
        {contract ? (
          <>
            <dl className="profile-list">
              <div>
                <dt>{webMessages.contractStatus}</dt>
                <dd>{contractStatusLabels[contract.status]}</dd>
              </div>
              <div>
                <dt>{webMessages.contractPlan}</dt>
                <dd>
                  {contract.plan
                    ? webMessages.contractPlanSummary
                        .replace("{name}", contract.plan.name)
                        .replace(
                          "{price}",
                          contract.plan.priceInclTax.toLocaleString("ja-JP"),
                        )
                        .replace("{credits}", String(contract.plan.credits))
                    : webMessages.contractWaitingPayment}
                </dd>
              </div>
              <div>
                <dt>{webMessages.contractDate}</dt>
                <dd>
                  {contract.anchorDate ?? webMessages.contractWaitingPayment}
                </dd>
              </div>
              <div>
                <dt>{webMessages.contractPeriod}</dt>
                <dd className="contract-period-range">
                  {contract.currentPeriod ? (
                    <>
                      <span className="contract-period-start">
                        <time dateTime={contract.currentPeriod.startsOn}>
                          {contract.currentPeriod.startsOn}
                        </time>
                        〜
                      </span>
                      <time dateTime={contract.currentPeriod.endsOn}>
                        {contract.currentPeriod.endsOn}
                      </time>
                    </>
                  ) : (
                    webMessages.contractCurrentPeriodUnavailable
                  )}
                </dd>
              </div>
              <div>
                <dt>{webMessages.contractCredits}</dt>
                <dd>
                  {contract.currentPeriod
                    ? `${contract.currentPeriod.balance} ${webMessages.contractBalanceUnit}`
                    : webMessages.contractCurrentBalanceUnavailable}
                </dd>
              </div>
            </dl>
            {contract.preview ? (
              <p className="invoice-preview-warning" role="note">
                {webMessages.contractPreview}
              </p>
            ) : null}
            <p>{webMessages.contractNextInvoiceNotice}</p>
            <section className="contract-summary">
              <h2>{webMessages.contractPlanChangeHeading}</h2>
              <p>{webMessages.contractPlanChangeGuidance}</p>
            </section>
          </>
        ) : null}
        <div className="profile-actions">
          <Link className="secondary-button" to="/me">
            {webMessages.contractBackHome}
          </Link>
          <div>
            {logoutError ? (
              <p className="error-message" role="alert">
                {webMessages.logoutError}
              </p>
            ) : null}
            <button
              className="secondary-button logout-button"
              onClick={() => void handleSignOut()}
              type="button"
            >
              {webMessages.logout}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
