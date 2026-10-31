import { webMessages } from "@kobito/shared";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { AdminLogoutButton } from "../auth/admin-session.js";
import { AdminBrand, AdminNavItem, AdminShell } from "../ui/index.js";

const navItems = [
  { to: "/admin/customers", label: webMessages.adminNavCustomers },
  { to: "/admin/requests", label: webMessages.adminNavRequests },
  { to: "/admin/bank-transfers", label: webMessages.adminNavBankTransfers },
  { to: "/admin/invoices", label: webMessages.adminNavInvoices },
  { to: "/admin/settings", label: webMessages.adminNavSettings },
];

/** 認証済みの管理画面すべてを包む、左メニュー付きの骨組み。 */
export function AdminLayout({
  serviceName,
  children,
}: {
  serviceName: string;
  children: ReactNode;
}) {
  return (
    <AdminShell
      brand={<AdminBrand serviceName={serviceName} />}
      subtitle={webMessages.adminShellSubtitle}
      navLabel={webMessages.adminNavLabel}
      nav={
        <>
          {navItems.map((item) => (
            <AdminNavItem component={NavLink} key={item.to} to={item.to}>
              {item.label}
            </AdminNavItem>
          ))}
          <AdminLogoutButton variant="nav" />
        </>
      }
    >
      {children}
    </AdminShell>
  );
}
