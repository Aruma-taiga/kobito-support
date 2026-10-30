import { type MeResponse, webMessages } from "@kobito/shared";
import { useEffect, useState } from "react";
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
        ) : null}
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
      </section>
    </main>
  );
}
