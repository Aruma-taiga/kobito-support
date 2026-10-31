import { webMessages } from "@kobito/shared";
import { Link, useLocation } from "react-router-dom";
import { TabBar, TabBarItem } from "../ui/index.js";

const tabs = [
  { to: "/me", icon: "⌂", label: webMessages.navHome, exact: true },
  { to: "/me/requests", icon: "☰", label: webMessages.navRequests },
  { to: "/me/invoices", icon: "¥", label: webMessages.navInvoices },
  { to: "/me/contract", icon: "◎", label: webMessages.navContract },
] as const;

/** 契約中のお客様の下部メニュー。現在地は URL から決める。 */
export function CustomerTabBar() {
  const { pathname } = useLocation();
  return (
    <TabBar label={webMessages.navLabel}>
      {tabs.map((tab) => {
        const current =
          "exact" in tab
            ? pathname === tab.to
            : pathname === tab.to || pathname.startsWith(`${tab.to}/`);
        return (
          <TabBarItem
            component={Link}
            current={current}
            icon={tab.icon}
            key={tab.to}
            to={tab.to}
          >
            {tab.label}
          </TabBarItem>
        );
      })}
    </TabBar>
  );
}
