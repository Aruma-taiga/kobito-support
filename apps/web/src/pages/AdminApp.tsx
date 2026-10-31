import { webMessages } from "@kobito/shared";
import { Navigate, Route, Routes } from "react-router-dom";
import {
  type AdminAuthClient,
  AdminAuthProvider,
  RequireAdminAuth,
} from "../auth/admin-session.js";
import type { AdminApiClient } from "../platform/admin-api-client.js";
import { AdminCustomerPage, AdminQueuePage } from "./AdminCustomerPages.js";
import { AdminLayout } from "./AdminLayout.js";
import { AdminLoginPage } from "./AdminLoginPage.js";
import { AdminPlanQuotePage } from "./AdminPlanQuotePage.js";
import { AdminReferralsPage } from "./AdminReferralsPage.js";
import {
  AdminRequestCreatePage,
  AdminRequestDetailPage,
  AdminRequestListPage,
} from "./AdminRequestPages.js";
import { AdminRetentionPage } from "./AdminRetentionPage.js";
import { AdminTodayPage } from "./AdminTodayPage.js";
import { AdminBankTransferPage } from "./BankTransferPage.js";
import {
  AdminInvoiceDetailPage,
  AdminInvoiceListPage,
} from "./InvoicePages.js";
import { AdminIssuerSettingsPage } from "./IssuerSettingsPage.js";

export type { AdminApiClient } from "../platform/admin-api-client.js";

export function AdminApp({
  authClient,
  apiClient,
  serviceName = webMessages.genericServiceName,
}: {
  authClient: AdminAuthClient;
  apiClient: AdminApiClient;
  serviceName?: string;
}) {
  return (
    <AdminAuthProvider client={authClient} apiClient={apiClient}>
      <Routes>
        <Route
          path="login"
          element={<AdminLoginPage serviceName={serviceName} />}
        />
        <Route
          element={
            <RequireAdminAuth
              serviceName={serviceName}
              layout={(content) => (
                <AdminLayout serviceName={serviceName}>{content}</AdminLayout>
              )}
            />
          }
        >
          <Route index element={<AdminTodayPage apiClient={apiClient} />} />
          <Route
            path="customers"
            element={<AdminQueuePage apiClient={apiClient} />}
          />
          <Route
            path="customers/:id"
            element={<AdminCustomerPage apiClient={apiClient} />}
          />
          <Route
            path="customers/:id/plan-quote"
            element={<AdminPlanQuotePage apiClient={apiClient} />}
          />
          <Route
            path="retention"
            element={<AdminRetentionPage apiClient={apiClient} />}
          />
          <Route
            path="referrals"
            element={<AdminReferralsPage apiClient={apiClient} />}
          />
          <Route
            path="invoices"
            element={<AdminInvoiceListPage apiClient={apiClient} />}
          />
          <Route
            path="requests"
            element={<AdminRequestListPage apiClient={apiClient} />}
          />
          <Route
            path="requests/new"
            element={<AdminRequestCreatePage apiClient={apiClient} />}
          />
          <Route
            path="requests/:id"
            element={<AdminRequestDetailPage apiClient={apiClient} />}
          />
          <Route
            path="bank-transfers"
            element={<AdminBankTransferPage apiClient={apiClient} />}
          />
          <Route
            path="settings"
            element={<AdminIssuerSettingsPage apiClient={apiClient} />}
          />
          <Route
            path="invoices/:id"
            element={<AdminInvoiceDetailPage apiClient={apiClient} />}
          />
        </Route>
        <Route path="*" element={<Navigate to="/admin/login" replace />} />
      </Routes>
    </AdminAuthProvider>
  );
}
