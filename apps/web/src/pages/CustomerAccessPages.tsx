import { type CustomerAccess, webMessages } from "@kobito/shared";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { SignOutAction } from "../auth/SignOutAction.js";
import { useAuthSession } from "../auth/session.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";
import { ApiClientError } from "../platform/api-client.js";
import { ContactEmailLink, useContact } from "../platform/contact.js";
import { MyInvoiceListPage } from "./InvoicePages.js";
import { MePage } from "./MePage.js";

type GateState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not_found" }
  | {
      status: "ready";
      access: CustomerAccess;
      uid: string;
      locationKey: string;
    };

interface CustomerAccessContextValue {
  access: CustomerAccess;
  markWelcomeSeen(): void;
}

const CustomerAccessContext = createContext<CustomerAccessContextValue | null>(
  null,
);

export function useCustomerAccess(): CustomerAccessContextValue {
  const value = useContext(CustomerAccessContext);
  if (!value) throw new Error("CustomerAccessGuard is required");
  return value;
}

function isInvoicePath(pathname: string): boolean {
  return pathname === "/me/invoices" || pathname.startsWith("/me/invoices/");
}

function allowedCustomerPath(
  access: CustomerAccess,
  pathname: string,
): boolean {
  if (access.access === "none") return pathname === "/me";
  if (access.access === "active") {
    if (access.welcomeRequired) return pathname === "/me/welcome";
    return (
      pathname === "/me" ||
      pathname === "/me/contract" ||
      pathname === "/me/requests" ||
      pathname.startsWith("/me/requests/") ||
      isInvoicePath(pathname)
    );
  }
  if (access.access === "pending") {
    if (access.contractStatus === "awaiting_quote_approval") {
      return pathname === "/me/plan-quote";
    }
    return (
      pathname === "/me/waiting" ||
      (access.invoiceAccess && isInvoicePath(pathname))
    );
  }
  if (access.access === "ended") {
    return access.invoiceAccess && isInvoicePath(pathname);
  }
  return pathname === "/me/finished";
}

function AccessErrorPage({ onRetry }: { onRetry(): void }) {
  const { signOut } = useAuthSession();
  const [logoutError, setLogoutError] = useState(false);
  async function logout() {
    setLogoutError(false);
    try {
      await signOut();
    } catch {
      setLogoutError(true);
    }
  }
  return (
    <main className="page-main">
      <section className="card access-card">
        <p className="error-message" role="alert">
          {webMessages.accessLoadError}
        </p>
        {logoutError ? (
          <p className="error-message" role="alert">
            {webMessages.logoutError}
          </p>
        ) : null}
        <div className="access-actions">
          <button className="secondary-button" onClick={onRetry} type="button">
            {webMessages.retry}
          </button>
          <button
            className="secondary-button"
            onClick={() => void logout()}
            type="button"
          >
            {webMessages.logout}
          </button>
        </div>
      </section>
    </main>
  );
}

function NotFoundPage() {
  const { signOut } = useAuthSession();
  return (
    <main className="page-main">
      <section className="card access-card">
        <h1>{webMessages.accessNotFound}</h1>
        <button
          className="secondary-button access-logout"
          onClick={() => void signOut().catch(() => undefined)}
          type="button"
        >
          {webMessages.logout}
        </button>
      </section>
    </main>
  );
}

export function CustomerAccessGuard({
  apiClient,
  children,
}: {
  apiClient: ReturnTypeApiClient;
  children?: ReactNode;
}) {
  const location = useLocation();
  const { state: session } = useAuthSession();
  const uid = session.status === "authenticated" ? session.user.uid : null;
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Incrementing attempt intentionally retriggers the access fetch after retry.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is a refetch trigger
  useEffect(() => {
    if (!uid) {
      setState({ status: "loading" });
      return;
    }
    let current = true;
    setState({ status: "loading" });
    void apiClient
      .getCustomerAccess()
      .then((access) => {
        if (current) {
          setState({
            status: "ready",
            access,
            uid,
            locationKey: location.key,
          });
        }
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (
          error instanceof ApiClientError &&
          (error.code === "not_found" || error.code === "forbidden")
        ) {
          setState({ status: "not_found" });
        } else {
          setState({ status: "error" });
        }
      });
    return () => {
      current = false;
    };
  }, [apiClient, attempt, location.key, uid]);

  const contextValue = useMemo<CustomerAccessContextValue | null>(() => {
    if (state.status !== "ready") return null;
    return {
      access: state.access,
      markWelcomeSeen: () =>
        setState((current) =>
          current.status === "ready"
            ? {
                status: "ready",
                access: {
                  ...current.access,
                  landingPath: "/me",
                  welcomeRequired: false,
                },
                uid: current.uid,
                locationKey: current.locationKey,
              }
            : current,
        ),
    };
  }, [state]);

  if (state.status === "loading") {
    return (
      <main className="page-main">
        <output className="status-message">{webMessages.profileLoading}</output>
      </main>
    );
  }
  if (state.status === "error") {
    return <AccessErrorPage onRetry={() => setAttempt((value) => value + 1)} />;
  }
  if (state.status === "not_found") return <NotFoundPage />;
  if (!uid || state.uid !== uid || state.locationKey !== location.key) {
    return (
      <main className="page-main">
        <output className="status-message">{webMessages.profileLoading}</output>
      </main>
    );
  }
  if (!allowedCustomerPath(state.access, location.pathname)) {
    return <Navigate to={state.access.landingPath} replace />;
  }
  return (
    <CustomerAccessContext.Provider key={uid} value={contextValue}>
      {children ?? <Outlet />}
    </CustomerAccessContext.Provider>
  );
}

export function CustomerWaitingPage() {
  const { access } = useCustomerAccess();
  const statusCopy =
    access.contractStatus === "under_review"
      ? webMessages.meWaitingUnderReview
      : access.contractStatus === "quoting"
        ? webMessages.meWaitingQuoting
        : webMessages.meWaitingPayment;
  return (
    <main className="page-main">
      <section className="card access-card" aria-labelledby="waiting-title">
        <h1 id="waiting-title">{webMessages.meWaitingTitle}</h1>
        <p className="muted-text">{webMessages.meWaitingDescription}</p>
        <p className="access-status-copy">{statusCopy}</p>
        {access.invoiceAccess ? (
          <Link className="primary-button access-link" to="/me/invoices">
            {webMessages.invoiceListTitle}
          </Link>
        ) : null}
        <SignOutAction />
      </section>
    </main>
  );
}

export function CustomerWelcomePage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  const { markWelcomeSeen } = useCustomerAccess();
  const { lineEnabled } = useContact();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  async function continueToHome() {
    if (submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      await apiClient.markWelcomeSeen();
      markWelcomeSeen();
      navigate("/me", { replace: true });
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-main">
      <section className="card access-card" aria-labelledby="welcome-title">
        <div className="welcome-check" aria-hidden="true">
          ✓
        </div>
        <h1 id="welcome-title">{webMessages.meWelcomeTitle}</h1>
        <p className="muted-text">
          {lineEnabled
            ? webMessages.meWelcomeDescription
            : webMessages.meWelcomeDescriptionEmail}
        </p>
        <section className="welcome-guidance">
          <h2>{webMessages.meWelcomeFlowTitle}</h2>
          <ol>
            <li>
              {lineEnabled ? (
                webMessages.meWelcomeFlowRequest
              ) : (
                <>
                  {webMessages.meWelcomeFlowRequestEmail}
                  <ContactEmailLink />
                </>
              )}
            </li>
            <li>{webMessages.meWelcomeFlowEstimate}</li>
            <li>{webMessages.meWelcomeFlowApprove}</li>
            <li>{webMessages.meWelcomeFlowWork}</li>
          </ol>
        </section>
        {error ? (
          <p className="error-message" role="alert">
            {webMessages.meWelcomeError}
          </p>
        ) : null}
        <button
          className="primary-button"
          disabled={submitting}
          onClick={() => void continueToHome()}
          type="button"
        >
          {submitting
            ? webMessages.applicationSubmitting
            : webMessages.meWelcomeContinue}
        </button>
        <SignOutAction />
      </section>
    </main>
  );
}

export function CustomerFinishedPage() {
  const { signOut } = useAuthSession();
  const [logoutError, setLogoutError] = useState(false);
  async function logout() {
    setLogoutError(false);
    try {
      await signOut();
    } catch {
      setLogoutError(true);
    }
  }
  return (
    <main className="page-main">
      <section className="card access-card" aria-labelledby="finished-title">
        <h1 id="finished-title">{webMessages.meFinishedTitle}</h1>
        <p className="muted-text">{webMessages.meFinishedDescription}</p>
        {logoutError ? (
          <p className="error-message" role="alert">
            {webMessages.logoutError}
          </p>
        ) : null}
        <button
          className="secondary-button"
          onClick={() => void logout()}
          type="button"
        >
          {webMessages.logout}
        </button>
      </section>
    </main>
  );
}

export function CustomerPlanQuoteUnavailablePage() {
  return <NotFoundPage />;
}

export function CustomerHomePage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  const { access } = useCustomerAccess();
  return (
    <MePage
      apiClient={apiClient}
      showAccountLinks={access.access === "active"}
      showContractAccess={access.access === "active"}
    />
  );
}

export function CustomerInvoicesPage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  const { access } = useCustomerAccess();
  const returnPath =
    access.access === "ended"
      ? null
      : access.access === "pending"
        ? "/me/waiting"
        : "/me";
  const accessNotice =
    access.access === "ended" && access.invoiceAccessUntil
      ? webMessages.accessEndedInvoicesUntil.replace(
          "{date}",
          access.invoiceAccessUntil,
        )
      : undefined;
  return (
    <MyInvoiceListPage
      apiClient={apiClient}
      returnPath={returnPath}
      returnLabel={
        returnPath === "/me/waiting"
          ? webMessages.meWaitingTitle
          : webMessages.homeTitle
      }
      accessNotice={accessNotice}
      showLogout={access.access === "ended" || access.access === "pending"}
    />
  );
}
