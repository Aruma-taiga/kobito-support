import { webMessages } from "@kobito/shared";
import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import type { AdminAuthClient } from "./auth/admin-session.js";
import type { AuthClient } from "./auth/session.js";
import { AuthProvider, RequireAuth } from "./auth/session.js";
import { AdminApp } from "./pages/AdminApp.js";
import { ApplicationPage } from "./pages/ApplicationPage.js";
import { ContractPage } from "./pages/ContractPage.js";
import {
  CustomerAccessGuard,
  CustomerFinishedPage,
  CustomerHomePage,
  CustomerInvoiceDetailPage,
  CustomerInvoicesPage,
  CustomerPlanQuoteUnavailablePage,
  CustomerWaitingPage,
  CustomerWelcomePage,
} from "./pages/CustomerAccessPages.js";
import { LiffPage } from "./pages/LiffPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { MyRequestDetailPage, MyRequestsPage } from "./pages/RequestPages.js";
import type { AdminApiClient } from "./platform/admin-api-client.js";
import type { ReturnTypeApiClient } from "./platform/api-client.js";
import { ContactProvider } from "./platform/contact.js";
import { BrandHeader, Button, Notice, Page } from "./ui/index.js";

type PublicConfigState =
  | { status: "loading"; attempt: number }
  | { status: "ready"; serviceName: string; contactEmail: string | null }
  | { status: "error" };

/** 管理画面は自分のメニューとロゴを持つので、お客様向けの上部ヘッダーは出さない。 */
function AppHeader({ serviceName }: { serviceName: string }) {
  const { pathname } = useLocation();
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return null;
  return (
    <BrandHeader
      serviceName={serviceName}
      right={<a href="/apply/shop">{webMessages.applicationTitle}</a>}
    />
  );
}

export function App({
  apiClient,
  authClient,
  adminApiClient,
  adminAuthClient,
  lineEnabled = false,
  lineLiffId,
}: {
  apiClient: ReturnTypeApiClient;
  authClient: AuthClient;
  adminApiClient: AdminApiClient;
  adminAuthClient: AdminAuthClient;
  lineEnabled?: boolean | undefined;
  lineLiffId?: string | undefined;
}) {
  const effectiveLiffId = lineEnabled ? lineLiffId : undefined;
  const [configState, setConfigState] = useState<PublicConfigState>({
    status: "loading",
    attempt: 0,
  });
  const [attempt, setAttempt] = useState(0);
  const serviceName =
    configState.status === "ready"
      ? configState.serviceName
      : webMessages.genericServiceName;

  useEffect(() => {
    let current = true;
    setConfigState({ status: "loading", attempt });
    void apiClient
      .getPublicConfig()
      .then((config) => {
        if (current) {
          setConfigState({
            status: "ready",
            serviceName: config.serviceName,
            contactEmail: config.contactEmail ?? null,
          });
        }
      })
      .catch(() => {
        if (current) setConfigState({ status: "error" });
      });
    return () => {
      current = false;
    };
  }, [apiClient, attempt]);

  useEffect(() => {
    document.title = serviceName;
  }, [serviceName]);

  return (
    <BrowserRouter>
      <div className="app-shell">
        <AppHeader serviceName={serviceName} />
        {configState.status === "loading" ? (
          <Page>
            <output className="ui-lead">
              {webMessages.serviceConfigLoading}
            </output>
          </Page>
        ) : null}
        {configState.status === "error" ? (
          <Page>
            <Notice tone="warn">{webMessages.serviceConfigError}</Notice>
            <Button
              variant="ghost"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {webMessages.retry}
            </Button>
          </Page>
        ) : null}
        {configState.status === "ready" ? (
          <ContactProvider
            value={{ lineEnabled, contactEmail: configState.contactEmail }}
          >
            <AuthProvider client={authClient}>
              <Routes>
                <Route path="/" element={<Navigate to="/me" replace />} />
                <Route
                  path="/login"
                  element={
                    <LoginPage
                      authClient={authClient}
                      lineLiffId={effectiveLiffId}
                    />
                  }
                />
                {lineEnabled ? (
                  <Route
                    path="/liff"
                    element={
                      <LiffPage
                        liffId={lineLiffId}
                        apiClient={apiClient}
                        authClient={authClient}
                      />
                    }
                  />
                ) : (
                  <Route path="/liff" element={<Navigate to="/" replace />} />
                )}
                <Route
                  path="/apply/*"
                  element={
                    <ApplicationPage
                      apiClient={apiClient}
                      authClient={authClient}
                    />
                  }
                />
                <Route
                  path="/admin/*"
                  element={
                    <AdminApp
                      apiClient={adminApiClient}
                      authClient={adminAuthClient}
                      serviceName={serviceName}
                    />
                  }
                />
                <Route element={<RequireAuth />}>
                  <Route
                    element={<CustomerAccessGuard apiClient={apiClient} />}
                  >
                    <Route
                      path="/me"
                      element={<CustomerHomePage apiClient={apiClient} />}
                    />
                    <Route
                      path="/me/waiting"
                      element={<CustomerWaitingPage apiClient={apiClient} />}
                    />
                    <Route
                      path="/me/welcome"
                      element={<CustomerWelcomePage apiClient={apiClient} />}
                    />
                    <Route
                      path="/me/contract"
                      element={
                        <ContractPage
                          apiClient={apiClient}
                          lineLiffId={effectiveLiffId}
                        />
                      }
                    />
                    <Route
                      path="/me/finished"
                      element={<CustomerFinishedPage />}
                    />
                    <Route
                      path="/me/plan-quote"
                      element={<CustomerPlanQuoteUnavailablePage />}
                    />
                    <Route
                      path="/me/requests"
                      element={<MyRequestsPage apiClient={apiClient} />}
                    />
                    <Route
                      path="/me/requests/:id"
                      element={<MyRequestDetailPage apiClient={apiClient} />}
                    />
                    <Route
                      path="/me/requests/:id/estimate"
                      element={<MyRequestDetailPage apiClient={apiClient} />}
                    />
                    <Route
                      path="/me/invoices"
                      element={<CustomerInvoicesPage apiClient={apiClient} />}
                    />
                    <Route
                      path="/me/invoices/:id"
                      element={
                        <CustomerInvoiceDetailPage apiClient={apiClient} />
                      }
                    />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AuthProvider>
          </ContactProvider>
        ) : null}
      </div>
    </BrowserRouter>
  );
}
