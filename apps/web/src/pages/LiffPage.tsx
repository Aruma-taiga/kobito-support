import { webMessages } from "@kobito/shared";
import { liff } from "@line/liff";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AuthClient } from "../auth/session.js";
import { useAuthSession } from "../auth/session.js";
import type { ReturnTypeApiClient } from "../platform/api-client.js";
import { ApiClientError } from "../platform/api-client.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function destination(search: string): string {
  const params = new URLSearchParams(search);
  if (params.get("to") === "estimate") {
    const id = params.get("id") ?? "";
    if (uuidPattern.test(id)) return `/me/requests/${id}`;
  }
  return "/me";
}

function safeLoginReturn(search: string): string {
  const params = new URLSearchParams(search);
  const to =
    params.get("to") === "estimate" && uuidPattern.test(params.get("id") ?? "")
      ? "estimate"
      : "home";
  const next = new URLSearchParams({ to });
  if (to === "estimate") next.set("id", params.get("id") ?? "");
  return `${window.location.origin}/liff?${next.toString()}`;
}

type Props = {
  liffId?: string | undefined;
  apiClient: ReturnTypeApiClient;
  authClient: AuthClient;
};

export function LiffPage({ liffId, apiClient, authClient }: Props) {
  const { state: session, getSessionGeneration } = useAuthSession();
  const location = useLocation();
  const navigate = useNavigate();
  const run = useRef(0);
  const liffInit = useRef<Promise<boolean> | null>(null);
  const autoStarted = useRef(false);
  const startLineRef = useRef<((automatic?: boolean) => Promise<void>) | null>(
    null,
  );
  const currentSearch = () =>
    window.location.pathname === "/liff"
      ? window.location.search
      : location.search;
  const [liffReady, setLiffReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineToken, setLineToken] = useState<string | null>(null);
  const [lineState, setLineState] = useState<
    "idle" | "checking" | "linked" | "unlinked"
  >("idle");
  const [knownAuthUserId, setKnownAuthUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(
    () => () => {
      run.current += 1;
      autoStarted.current = false;
    },
    [],
  );

  useEffect(() => {
    if (session.status === "loading" || !liffId || autoStarted.current) return;
    autoStarted.current = true;
    void startLineRef.current?.(true);
  }, [session.status, liffId]);

  async function initializeLiff(): Promise<boolean> {
    if (!liffId) throw new Error("not-configured");
    if (!liffInit.current) {
      liffInit.current = liff.init({ liffId }).then(
        () => true,
        (cause: unknown) => {
          liffInit.current = null;
          throw cause;
        },
      );
    }
    await liffInit.current;
    setLiffReady(true);
    return liff.isLoggedIn();
  }

  async function acquireToken(automatic = false): Promise<string | null> {
    const loggedIn = await initializeLiff();
    if (!loggedIn) {
      if (!automatic)
        liff.login({ redirectUri: safeLoginReturn(currentSearch()) });
      throw new Error(automatic ? "not-logged-in" : "redirecting");
    }
    const token = liff.getIDToken();
    if (!token) throw new Error("missing-token");
    return token;
  }

  async function startLine(automatic = false) {
    if (busy) return;
    const op = ++run.current;
    const sessionGenerationAtStart = getSessionGeneration();
    setBusy(true);
    setError(null);
    const initialUid = authClient.currentUser()?.uid ?? null;
    try {
      const token = await acquireToken(automatic);
      if (!token) return;
      if (run.current !== op) return;
      if (getSessionGeneration() !== sessionGenerationAtStart) {
        setLineToken(null);
        setLineState("idle");
        return;
      }
      setLineToken(token);
      setLineState("checking");
      const response = await apiClient.signInWithLine(token);
      if (run.current !== op) return;
      if (getSessionGeneration() !== sessionGenerationAtStart) {
        setLineToken(null);
        setLineState("idle");
        return;
      }
      const current = authClient.currentUser();
      if (initialUid !== null && current?.uid !== initialUid) {
        setLineToken(null);
        setLineState("idle");
        return;
      }
      setKnownAuthUserId(response.authUserId);
      setLineState("linked");
      if (current && current.uid !== response.authUserId) return;
      const signedInUser = await authClient.signInWithCustomToken(
        response.customToken,
      );
      if (run.current !== op) return;
      if (
        signedInUser.uid !== response.authUserId ||
        authClient.currentUser()?.uid !== response.authUserId
      ) {
        setError(webMessages.lineSwitchWarning);
        return;
      }
      navigate(destination(currentSearch()), { replace: true });
    } catch (cause) {
      if (run.current !== op) return;
      if (getSessionGeneration() !== sessionGenerationAtStart) {
        setLineToken(null);
        setLineState("idle");
        return;
      }
      if (
        cause instanceof Error &&
        ["redirecting", "not-logged-in"].includes(cause.message)
      )
        return;
      if (cause instanceof ApiClientError && cause.code === "not_found") {
        setLineState("unlinked");
        return;
      }
      setLineToken(null);
      setLineState("idle");
      setError(webMessages.lineUnavailable);
    } finally {
      if (run.current === op) setBusy(false);
    }
  }
  startLineRef.current = startLine;

  async function linkCurrentAccount(token = lineToken) {
    const user = authClient.currentUser();
    if (!user || !token || busy) return;
    const uid = user.uid;
    const sessionGenerationAtStart = getSessionGeneration();
    const op = ++run.current;
    setBusy(true);
    setError(null);
    try {
      await apiClient.linkLine(token, uid);
      if (
        run.current === op &&
        getSessionGeneration() === sessionGenerationAtStart &&
        authClient.currentUser()?.uid === uid
      ) {
        navigate(destination(currentSearch()), { replace: true });
      }
    } catch (cause) {
      if (
        run.current !== op ||
        getSessionGeneration() !== sessionGenerationAtStart ||
        authClient.currentUser()?.uid !== uid
      )
        return;
      if (
        cause instanceof ApiClientError &&
        cause.code === "invalid_line_token"
      ) {
        setLineToken(null);
        setLineState("idle");
      }
      setError(
        cause instanceof ApiClientError && cause.code === "conflict"
          ? webMessages.lineLinkConflict
          : webMessages.lineUnavailable,
      );
    } finally {
      if (run.current === op) setBusy(false);
    }
  }

  async function loginAndLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !lineToken) return;
    const op = ++run.current;
    setBusy(true);
    setError(null);
    let expectedUid: string | null = null;
    let expectedGeneration: number | null = null;
    try {
      const credentialUser = await authClient.signIn(email.trim(), password);
      setPassword("");
      if (run.current !== op) return;
      const user = authClient.currentUser();
      if (!user || user.uid !== credentialUser.uid) {
        setError(webMessages.lineSwitchWarning);
        return;
      }
      expectedUid = credentialUser.uid;
      const sessionGenerationAtStart = getSessionGeneration();
      expectedGeneration = sessionGenerationAtStart;
      await apiClient.linkLine(lineToken, credentialUser.uid);
      if (
        run.current === op &&
        getSessionGeneration() === sessionGenerationAtStart &&
        authClient.currentUser()?.uid === credentialUser.uid
      )
        navigate(destination(currentSearch()), { replace: true });
    } catch (cause) {
      if (
        run.current === op &&
        (expectedUid === null ||
          (authClient.currentUser()?.uid === expectedUid &&
            getSessionGeneration() === expectedGeneration))
      ) {
        if (
          cause instanceof ApiClientError &&
          cause.code === "invalid_line_token"
        ) {
          setLineToken(null);
          setLineState("idle");
        }
        setError(
          cause instanceof ApiClientError && cause.code === "conflict"
            ? webMessages.lineLinkConflict
            : webMessages.loginError,
        );
      }
    } finally {
      if (run.current === op) setBusy(false);
    }
  }

  if (session.status === "loading")
    return (
      <main className="page-main">
        <output className="status-message">{webMessages.sessionLoading}</output>
      </main>
    );
  if (!liffId)
    return (
      <main className="page-main">
        <section className="card">
          <output className="status-message">
            {webMessages.lineNotConfigured}
          </output>
        </section>
      </main>
    );

  return (
    <main className="page-main">
      <section className="card login-card" aria-labelledby="liff-title">
        <h1 id="liff-title">{webMessages.lineLogin}</h1>
        {error ? (
          <p className="error-message" role="alert">
            {error}
          </p>
        ) : null}
        {lineToken &&
        lineState === "unlinked" &&
        session.status === "authenticated" ? (
          <>
            <p>{webMessages.lineLinkRequired}</p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void linkCurrentAccount()}
              type="button"
            >
              {webMessages.lineLink}
            </button>
          </>
        ) : null}
        {knownAuthUserId &&
        session.status === "authenticated" &&
        session.user.uid !== knownAuthUserId &&
        error !== webMessages.lineSwitchWarning ? (
          <>
            <p role="alert">{webMessages.lineSwitchWarning}</p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={async () => {
                if (!lineToken) return;
                const op = ++run.current;
                const sessionGenerationAtStart = getSessionGeneration();
                const currentUid = authClient.currentUser()?.uid ?? null;
                setBusy(true);
                try {
                  const result = await apiClient.signInWithLine(lineToken);
                  if (
                    op !== run.current ||
                    result.authUserId !== knownAuthUserId ||
                    getSessionGeneration() !== sessionGenerationAtStart ||
                    (currentUid !== null &&
                      authClient.currentUser()?.uid !== currentUid)
                  )
                    return;
                  const signedInUser = await authClient.signInWithCustomToken(
                    result.customToken,
                  );
                  if (op !== run.current) return;
                  if (
                    signedInUser.uid !== result.authUserId ||
                    authClient.currentUser()?.uid !== result.authUserId
                  ) {
                    setError(webMessages.lineSwitchWarning);
                    return;
                  }
                  navigate(destination(currentSearch()), { replace: true });
                } catch {
                  if (
                    op === run.current &&
                    getSessionGeneration() === sessionGenerationAtStart
                  )
                    setError(webMessages.lineUnavailable);
                } finally {
                  if (op === run.current) setBusy(false);
                }
              }}
              type="button"
            >
              {webMessages.lineSwitchAccount}
            </button>
          </>
        ) : null}
        {lineToken &&
        lineState === "unlinked" &&
        session.status === "signed_out" ? (
          <form onSubmit={loginAndLink}>
            <p>{webMessages.lineLinkRequired}</p>
            <label className="field-label" htmlFor="line-email">
              {webMessages.emailLabel}
            </label>
            <input
              id="line-email"
              autoComplete="username"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <label className="field-label" htmlFor="line-password">
              {webMessages.passwordLabel}
            </label>
            <input
              id="line-password"
              autoComplete="current-password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            <button className="primary-button" disabled={busy} type="submit">
              {webMessages.lineLinkAction}
            </button>
          </form>
        ) : null}
        {lineState === "checking" ? (
          <output className="status-message">{webMessages.lineLoading}</output>
        ) : null}
        {!liffReady ? (
          <output className="status-message">{webMessages.lineLoading}</output>
        ) : null}
        {!lineToken ? (
          <button
            className="primary-button"
            disabled={busy || !liffReady}
            onClick={() => void startLine()}
            type="button"
          >
            {busy ? webMessages.lineLoading : webMessages.lineLogin}
          </button>
        ) : null}
      </section>
    </main>
  );
}
