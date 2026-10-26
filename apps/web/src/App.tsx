import { webMessages } from "@kobito/shared";
import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { AdminAuthClient } from "./auth/admin-session.js";
import type { AuthClient } from "./auth/session.js";
import { AuthProvider, RequireAuth } from "./auth/session.js";
import { AdminApp } from "./pages/AdminApp.js";
import { ApplicationPage } from "./pages/ApplicationPage.js";
import {
  MyInvoiceDetailPage,
  MyInvoiceListPage,
} from "./pages/InvoicePages.js";
import { LoginPage } from "./pages/LoginPage.js";
import { MePage } from "./pages/MePage.js";
import { MyRequestDetailPage, MyRequestsPage } from "./pages/RequestPages.js";
import type { AdminApiClient } from "./platform/admin-api-client.js";
import type { ReturnTypeApiClient } from "./platform/api-client.js";

type PublicConfigState =
  | { status: "loading"; attempt: number }
  | { status: "ready"; serviceName: string }
  | { status: "error" };

export function App({
  apiClient,
  authClient,
  adminApiClient,
  adminAuthClient,
}: {
  apiClient: ReturnTypeApiClient;
  authClient: AuthClient;
  adminApiClient: AdminApiClient;
  adminAuthClient: AdminAuthClient;
}) {
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
          setConfigState({ status: "ready", serviceName: config.serviceName });
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
    <div className="app-shell">
      <header className="topbar">
        <span className="service-name">{serviceName}</span>
        <a className="topbar-link" href="/apply/shop">
          {webMessages.applicationTitle}
        </a>
      </header>
      {configState.status === "loading" ? (
        <main className="page-main">
          <output className="status-message">
            {webMessages.serviceConfigLoading}
          </output>
        </main>
      ) : null}
      {configState.status === "error" ? (
        <main className="page-main">
          <section className="card config-error-card">
            <p className="error-message" role="alert">
              {webMessages.serviceConfigError}
            </p>
            <button
              className="secondary-button"
              onClick={() => setAttempt((value) => value + 1)}
              type="button"
            >
              {webMessages.retry}
            </button>
          </section>
        </main>
      ) : null}
      {configState.status === "ready" ? (
        <AuthProvider client={authClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Navigate to="/me" replace />} />
              <Route
                path="/login"
                element={<LoginPage authClient={authClient} />}
              />
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
                  />
                }
              />
              <Route element={<RequireAuth />}>
                <Route path="/me" element={<MePage apiClient={apiClient} />} />
                <Route
                  path="/me/requests"
                  element={<MyRequestsPage apiClient={apiClient} />}
                />
                <Route
                  path="/me/requests/:id"
                  element={<MyRequestDetailPage apiClient={apiClient} />}
                />
                <Route
                  path="/me/invoices"
                  element={<MyInvoiceListPage apiClient={apiClient} />}
                />
                <Route
                  path="/me/invoices/:id"
                  element={<MyInvoiceDetailPage apiClient={apiClient} />}
                />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      ) : null}
    </div>
  );
}
