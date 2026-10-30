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
import { Navigate, Outlet } from "react-router-dom";

export interface AuthUser {
  uid: string;
  email: string | null;
  getIdToken(): Promise<string>;
}

export interface AuthClient {
  currentUser(): AuthUser | null;
  subscribe(listener: (user: AuthUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<AuthUser>;
  signInWithCustomToken(token: string): Promise<AuthUser>;
  signUp(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
}

export type SessionState =
  | { status: "loading"; user: null }
  | { status: "signed_out"; user: null }
  | { status: "authenticated"; user: AuthUser };

interface AuthContextValue {
  state: SessionState;
  sessionGeneration: number;
  getSessionGeneration(): number;
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
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const sessionGenerationRef = useRef(0);

  useEffect(() => {
    let previousUid: string | null | undefined;
    return client.subscribe((user) => {
      const nextUid = user?.uid ?? null;
      if (previousUid !== undefined && previousUid !== nextUid) {
        sessionGenerationRef.current += 1;
        setSessionGeneration(sessionGenerationRef.current);
      }
      previousUid = nextUid;
      setState(
        user
          ? { status: "authenticated", user }
          : { status: "signed_out", user: null },
      );
    });
  }, [client]);

  const value = useMemo(
    () => ({
      state,
      sessionGeneration,
      getSessionGeneration: () => sessionGenerationRef.current,
      signOut: () => client.signOut(),
    }),
    [client, sessionGeneration, state],
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
