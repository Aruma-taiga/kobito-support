import {
  contractStatusLabels,
  type MeResponse,
  webMessages,
} from "@kobito/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthSession } from "../auth/session.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";
import { ApiClientError } from "../platform/api-client.js";

type PageState =
  | { status: "loading"; attempt: number }
  | { status: "ready"; data: MeResponse }
  | { status: "error"; reason: "profile" | "session" };

export function MePage({ apiClient }: { apiClient: ReturnTypeApiClient }) {
  const { signOut } = useAuthSession();
  const [state, setState] = useState<PageState>({
    status: "loading",
    attempt: 0,
  });
  const [attempt, setAttempt] = useState(0);
  const [logoutError, setLogoutError] = useState(false);
  const [contract, setContract] = useState<Awaited<
    ReturnType<ReturnTypeApiClient["getContract"]>
  > | null>(null);
  const [contractError, setContractError] = useState(false);

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

  return (
    <main className="page-main">
      <section className="card profile-card" aria-labelledby="home-title">
        <h1 id="home-title">{webMessages.homeTitle}</h1>
        {state.status === "loading" ? (
          <output className="status-message">
            {webMessages.profileLoading}
          </output>
        ) : null}
        {state.status === "error" ? (
          <div>
            <p className="error-message" role="alert">
              {state.reason === "session"
                ? webMessages.sessionExpiredError
                : webMessages.profileError}
            </p>
            {state.reason === "profile" ? (
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
        {state.status === "ready" ? (
          <>
            <dl className="profile-list">
              <div>
                <dt>{webMessages.shopNameLabel}</dt>
                <dd>{state.data.customer.shopName}</dd>
              </div>
              <div>
                <dt>{webMessages.contactNameLabel}</dt>
                <dd>{state.data.customer.contactName}</dd>
              </div>
            </dl>
            <section
              className="contract-summary"
              aria-labelledby="contract-summary-title"
            >
              <h2 id="contract-summary-title">{webMessages.contractTitle}</h2>
              {contractError ? (
                <p className="error-message" role="alert">
                  {webMessages.contractLoadError}
                </p>
              ) : null}
              {!contractError && !contract ? (
                <output>{webMessages.contractLoading}</output>
              ) : null}
              {contract?.contract ? (
                <dl className="profile-list">
                  <div>
                    <dt>{webMessages.contractStatus}</dt>
                    <dd>{contractStatusLabels[contract.contract.status]}</dd>
                  </div>
                  <div>
                    <dt>{webMessages.contractPlan}</dt>
                    <dd>
                      {contract.contract.plan
                        ? `${contract.contract.plan.name}・${contract.contract.plan.priceInclTax.toLocaleString("ja-JP")}円（税込）・${contract.contract.plan.credits}${webMessages.contractBalanceUnit}`
                        : webMessages.contractWaitingPayment}
                    </dd>
                  </div>
                  <div>
                    <dt>{webMessages.contractDate}</dt>
                    <dd>
                      {contract.contract.anchorDate ??
                        webMessages.contractWaitingPayment}
                    </dd>
                  </div>
                  <div>
                    <dt>{webMessages.contractPeriod}</dt>
                    <dd>
                      {contract.contract.currentPeriod
                        ? `${contract.contract.currentPeriod.startsOn}〜${contract.contract.currentPeriod.endsOn}`
                        : webMessages.contractWaitingPayment}
                    </dd>
                  </div>
                  <div>
                    <dt>{webMessages.contractCredits}</dt>
                    <dd>
                      {contract.contract.currentPeriod
                        ? `${contract.contract.currentPeriod.balance} ${webMessages.contractBalanceUnit}`
                        : `0 ${webMessages.contractBalanceUnit}`}
                    </dd>
                  </div>
                </dl>
              ) : null}
              {contract?.contract && !contract.contract.currentPeriod ? (
                <p>{webMessages.contractNoCredits}</p>
              ) : null}
              {!contractError && contract?.contract === null ? (
                <p>{webMessages.contractNone}</p>
              ) : null}
              {contract?.contract?.preview ? (
                <p className="invoice-preview-warning" role="note">
                  {webMessages.contractPreview}
                </p>
              ) : null}
            </section>
          </>
        ) : null}
        <div className="profile-actions">
          {state.status === "ready" ? (
            <Link className="secondary-button" to="/me/invoices">
              {webMessages.invoiceListTitle}
            </Link>
          ) : null}
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
