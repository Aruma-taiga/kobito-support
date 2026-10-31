import { webMessages } from "@kobito/shared";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import {
  type AdminApiClient,
  AdminApiError,
} from "../platform/admin-api-client.js";
import { AdminAuthFrame, AdminBrand, Button, Notice } from "../ui/index.js";

export type AdminFactorId = "phone" | "totp";

export interface AdminMfaFactor {
  uid: string;
  factorId: AdminFactorId;
  displayName: string | null;
  phoneNumber?: string;
}

export type AdminSignInResult =
  | { status: "signed_in" }
  | { status: "mfa_required"; factors: AdminMfaFactor[] };

export interface AdminAuthUser {
  email: string | null;
  getIdToken(): Promise<string>;
}

export interface AdminAuthClient {
  currentUser(): AdminAuthUser | null;
  subscribe(listener: (user: AdminAuthUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<AdminSignInResult>;
  startTotpEnrollment(issuer: string): Promise<{ secret: string; uri: string }>;
  completeTotpEnrollment(secret: string, code: string): Promise<void>;
  clearTotpEnrollment(): void;
  startSecondFactor(
    factorUid: string,
    recaptchaContainer?: HTMLElement | null,
  ): Promise<void>;
  completeSecondFactor(factorUid: string, code: string): Promise<void>;
  cancelSecondFactor(): void;
  signOut(): Promise<void>;
}

export type AdminAuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "verifying" }
  | { status: "authorized"; user: AdminAuthUser }
  | { status: "denied"; user: AdminAuthUser; message: string };

interface AdminAuthContextValue {
  client: AdminAuthClient;
  apiClient: AdminApiClient;
  state: AdminAuthState;
  signOut(): Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({
  client,
  apiClient,
  children,
}: {
  client: AdminAuthClient;
  apiClient: AdminApiClient;
  children: ReactNode;
}) {
  const [state, setState] = useState<AdminAuthState>({ status: "loading" });
  const sequence = useRef(0);
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    let active = true;
    const unsubscribe = client.subscribe((user) => {
      const currentSequence = ++sequence.current;
      if (!user) {
        setState({ status: "signed_out" });
        return;
      }
      if (pathnameRef.current === "/admin/enroll") {
        setState({ status: "signed_out" });
        return;
      }
      setState({ status: "verifying" });
      void apiClient
        .getSession()
        .then((session) => {
          if (!active || currentSequence !== sequence.current) return;
          if (session.role !== "admin") {
            setState({
              status: "denied",
              user,
              message: webMessages.adminRoleRequired,
            });
            return;
          }
          setState({ status: "authorized", user });
        })
        .catch((error: unknown) => {
          if (!active || currentSequence !== sequence.current) return;
          if (error instanceof AdminApiError && error.code === "unauthorized") {
            setState({ status: "signed_out" });
            void client.signOut().catch(() => undefined);
          } else {
            setState({
              status: "denied",
              user,
              message:
                error instanceof AdminApiError && error.code === "forbidden"
                  ? webMessages.adminAccountDisabled
                  : error instanceof AdminApiError && error.code === "not_found"
                    ? webMessages.adminRoleRequired
                    : webMessages.adminMfaChallengeError,
            });
          }
        });
    });
    return () => {
      active = false;
      sequence.current += 1;
      unsubscribe();
    };
  }, [apiClient, client]);

  const value = useMemo<AdminAuthContextValue>(
    () => ({ client, apiClient, state, signOut: () => client.signOut() }),
    [apiClient, client, state],
  );
  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error("AdminAuthProvider is required");
  return context;
}

export function RequireAdminAuth({
  serviceName = webMessages.genericServiceName,
  layout,
}: {
  serviceName?: string;
  /** 認証済みの本文を包む骨組み（左メニューなど） */
  layout?: (content: ReactNode) => ReactNode;
}) {
  const { state } = useAdminAuth();
  if (state.status === "loading" || state.status === "verifying") {
    return (
      <output className="status-message">{webMessages.sessionLoading}</output>
    );
  }
  if (state.status === "signed_out") {
    return <Navigate to="/admin/login" replace />;
  }
  if (state.status === "denied") {
    return (
      <AdminAuthFrame
        brand={<AdminBrand serviceName={serviceName} />}
        badge={webMessages.adminBadge}
      >
        <h1 id="admin-denied-title">{webMessages.adminLoginTitle}</h1>
        <Notice tone="warn">{state.message}</Notice>
        <AdminLogoutButton />
      </AdminAuthFrame>
    );
  }
  const content = <Outlet />;
  return <>{layout ? layout(content) : content}</>;
}

export function AdminLogoutButton({
  variant = "button",
}: {
  variant?: "button" | "nav";
}) {
  const { signOut } = useAdminAuth();
  const [error, setError] = useState(false);

  async function logout() {
    setError(false);
    try {
      await signOut();
    } catch {
      setError(true);
    }
  }

  return (
    <>
      {error ? <Notice tone="warn">{webMessages.logoutError}</Notice> : null}
      {variant === "nav" ? (
        <button
          className="ui-admin__link ui-admin__out"
          onClick={() => void logout()}
          type="button"
        >
          {webMessages.adminLogout}
        </button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          {webMessages.adminLogout}
        </Button>
      )}
    </>
  );
}
