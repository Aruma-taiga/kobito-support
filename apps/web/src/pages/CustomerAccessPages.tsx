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
import { ContactEmailLink, MailText, useContact } from "../platform/contact.js";
import { dayAfter, formatMonthDay } from "../platform/format.js";
import {
  Button,
  buttonClass,
  Card,
  DoneMark,
  Hint,
  Lead,
  Notice,
  Page,
  Steps,
  Timeline,
  Title,
} from "../ui/index.js";
import {
  MyInvoiceDetailPage as CustomerInvoiceDetailView,
  InvoicePayCard,
  isUnpaid,
  MyInvoiceListPage,
  useCustomerInvoices,
} from "./CustomerInvoices.js";
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
    <Page>
      <Notice tone="warn">{webMessages.accessLoadError}</Notice>
      {logoutError ? (
        <Notice tone="warn">{webMessages.logoutError}</Notice>
      ) : null}
      <div className="ui-actions">
        <Button variant="ghost" onClick={onRetry}>
          {webMessages.retry}
        </Button>
        <Button variant="ghost" onClick={() => void logout()}>
          {webMessages.logout}
        </Button>
      </div>
    </Page>
  );
}

function NotFoundPage() {
  const { signOut } = useAuthSession();
  return (
    <Page>
      <Title>{webMessages.accessNotFound}</Title>
      <div className="ui-actions">
        <Button
          variant="ghost"
          onClick={() => void signOut().catch(() => undefined)}
        >
          {webMessages.logout}
        </Button>
      </div>
    </Page>
  );
}

function LoadingPage() {
  return (
    <Page>
      <output className="ui-lead">{webMessages.profileLoading}</output>
    </Page>
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
    return <LoadingPage />;
  }
  if (state.status === "error") {
    return <AccessErrorPage onRetry={() => setAttempt((value) => value + 1)} />;
  }
  if (state.status === "not_found") return <NotFoundPage />;
  if (!uid || state.uid !== uid || state.locationKey !== location.key) {
    return <LoadingPage />;
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

const progressLabels = [
  webMessages.meStepApply,
  webMessages.meStepInvoice,
  webMessages.meStepPayment,
  webMessages.meStepStart,
];

/** 審査中・見積り作成中は「お申込み」、請求書の送付後は「お支払い」の段階。 */
export function CustomerWaitingPage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  const { access } = useCustomerAccess();
  const awaitingPayment = access.contractStatus === "awaiting_payment";
  const [title, lead] =
    access.contractStatus === "under_review"
      ? [webMessages.meWaitingReviewTitle, webMessages.meWaitingReviewLead]
      : access.contractStatus === "quoting"
        ? [webMessages.meWaitingQuotingTitle, webMessages.meWaitingQuotingLead]
        : [webMessages.meWaitingPaymentTitle, webMessages.meWaitingPaymentLead];
  return (
    <Page>
      <Steps
        current={awaitingPayment ? 2 : 0}
        label={webMessages.meWaitingTitle}
        labels={progressLabels}
      />
      <Title id="waiting-title">{title}</Title>
      <Lead>{lead}</Lead>
      {awaitingPayment && access.invoiceAccess ? (
        <WaitingInvoices apiClient={apiClient} />
      ) : null}
      {awaitingPayment ? (
        <Hint align="center">
          <MailText template={webMessages.invoiceChangeMethod} />
        </Hint>
      ) : null}
      {access.invoiceAccess ? (
        <div className="ui-actions">
          <Link className={buttonClass("ghost")} to="/me/invoices">
            {webMessages.invoiceListTitle}
          </Link>
        </div>
      ) : null}
      <SignOutAction />
    </Page>
  );
}

function WaitingInvoices({ apiClient }: { apiClient: ReturnTypeApiClient }) {
  const { state, retry } = useCustomerInvoices(apiClient);
  if (state.status === "loading") {
    return (
      <output className="ui-lead">{webMessages.invoiceListLoading}</output>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <Notice tone="warn">{webMessages.meWaitingInvoiceError}</Notice>
        <Button variant="ghost" onClick={retry}>
          {webMessages.invoiceRetry}
        </Button>
      </>
    );
  }
  const unpaid = state.invoices.filter(isUnpaid);
  if (unpaid.length === 0) {
    return <Notice tone="info">{webMessages.meWaitingNoInvoice}</Notice>;
  }
  return (
    <>
      {unpaid.map((invoice) => (
        <InvoicePayCard
          detail={state.details[invoice.id]}
          initialStage
          invoice={invoice}
          key={invoice.id}
        />
      ))}
    </>
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
  const [period, setPeriod] = useState<{
    credits: number;
    nextGrantOn: string;
  } | null>(null);

  // 付与数と次の付与日は契約情報から読む。読めなくても案内は出す。
  useEffect(() => {
    let current = true;
    void apiClient
      .getContract()
      .then(({ contract }) => {
        if (current && contract?.currentPeriod) {
          setPeriod({
            credits: contract.currentPeriod.credits,
            nextGrantOn: dayAfter(contract.currentPeriod.endsOn),
          });
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [apiClient]);

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

  const description = lineEnabled
    ? webMessages.meWelcomeDescription
    : period
      ? webMessages.meWelcomeDescriptionCredits.replace(
          "{credits}",
          String(period.credits),
        )
      : webMessages.meWelcomeDescriptionEmail;

  return (
    <Page>
      <DoneMark />
      <Title center id="welcome-title">
        {webMessages.meWelcomeTitle}
      </Title>
      <Lead center>{description}</Lead>
      <Card title={webMessages.meWelcomeFlowTitle}>
        <Timeline
          items={[
            {
              key: "request",
              done: true,
              content: lineEnabled ? (
                webMessages.meWelcomeFlowRequest
              ) : (
                <>
                  {webMessages.meWelcomeFlowRequestEmail}
                  <span className="ui-timeline__note">
                    <ContactEmailLink />
                  </span>
                </>
              ),
            },
            {
              key: "estimate",
              done: true,
              content: webMessages.meWelcomeFlowEstimate,
            },
            {
              key: "approve",
              done: true,
              content: webMessages.meWelcomeFlowApprove,
            },
            {
              key: "work",
              done: true,
              content: webMessages.meWelcomeFlowWork,
            },
          ]}
        />
        <Hint>
          {period
            ? webMessages.meWelcomeCreditsNote.replace(
                "{date}",
                formatMonthDay(period.nextGrantOn),
              )
            : webMessages.meWelcomeCreditsNoteGeneric}
        </Hint>
      </Card>
      {error ? <Notice tone="warn">{webMessages.meWelcomeError}</Notice> : null}
      <Button disabled={submitting} onClick={() => void continueToHome()}>
        {submitting
          ? webMessages.applicationSubmitting
          : webMessages.meWelcomeContinue}
      </Button>
      <SignOutAction />
    </Page>
  );
}

export function CustomerFinishedPage() {
  const { access } = useCustomerAccess();
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
  const template =
    access.contractStatus === "declined"
      ? webMessages.meFinishedDeclined
      : access.contractStatus === "lapsed"
        ? webMessages.meFinishedLapsed
        : null;
  return (
    <Page>
      <Title id="finished-title">{webMessages.meFinishedTitle}</Title>
      <Lead>
        {template ? (
          <MailText template={template} />
        ) : (
          webMessages.meFinishedDescription
        )}
      </Lead>
      {logoutError ? (
        <Notice tone="warn">{webMessages.logoutError}</Notice>
      ) : null}
      <Button variant="ghost" onClick={() => void logout()}>
        {webMessages.logout}
      </Button>
    </Page>
  );
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
  const returnPath = access.access === "pending" ? "/me/waiting" : null;
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
      tabbed={access.access === "active"}
    />
  );
}

export function CustomerInvoiceDetailPage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  const { access } = useCustomerAccess();
  return (
    <CustomerInvoiceDetailView
      apiClient={apiClient}
      tabbed={access.access === "active"}
    />
  );
}
