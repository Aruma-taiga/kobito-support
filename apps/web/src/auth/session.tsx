import { webMessages } from "@kobito/shared";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Navigate, Outlet } from "react-router-dom";

export interface AuthUser {
  getIdToken(): Promise<string>;
}

export interface AuthClient {
  currentUser(): AuthUser | null;
  subscribe(listener: (user: AuthUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

export type SessionState =
  | { status: "loading"; user: null }
  | { status: "signed_out"; user: null }
  | { status: "authenticated"; user: AuthUser };

interface AuthContextValue {
  state: SessionState;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  client,
  children,
}: {
  client: AuthClient;
  children: ReactNode;
}) {
  const [state, setState] = useState<SessionState>({
    status: "loading",
    user: null,
  });

  useEffect(
    () =>
      client.subscribe((user) =>
        setState(
          user
            ? { status: "authenticated", user }
            : { status: "signed_out", user: null },
        ),
      ),
    [client],
  );

  const value = useMemo(
    () => ({ state, signOut: () => client.signOut() }),
    [client, state],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthSession(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is required");
  return context;
}

export function RequireAuth() {
  const { state } = useAuthSession();
  if (state.status === "loading") {
    return (
      <output className="status-message">{webMessages.sessionLoading}</output>
    );
  }
  if (state.status === "signed_out") return <Navigate to="/login" replace />;
  return <Outlet />;
}
