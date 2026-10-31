import { webMessages } from "@kobito/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  type AdminFactorId,
  AdminLogoutButton,
  useAdminAuth,
} from "../auth/admin-session.js";
import { AdminAuthClientError } from "../auth/firebase-admin-client.js";
import {
  ActionBar,
  AdminAuthFrame,
  AdminBrand,
  Button,
  Field,
  Hint,
  Notice,
  Page,
} from "../ui/index.js";

function adminMfaFactorLabel(factorId: AdminFactorId): string {
  return factorId === "phone"
    ? webMessages.adminMfaSmsCodeLabel
    : webMessages.adminMfaTotpCodeLabel;
}

export function AdminLoginPage({ serviceName }: { serviceName: string }) {
  const { client, state } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [factors, setFactors] = useState<
    Array<{ uid: string; factorId: AdminFactorId; displayName: string | null }>
  >([]);
  const [selectedFactorUid, setSelectedFactorUid] = useState("");
  const [factorAttempt, setFactorAttempt] = useState(0);
  const [challengeStarted, setChallengeStarted] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mfaCompleted, setMfaCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recaptchaContainer = useRef<HTMLDivElement | null>(null);
  const startAttempt = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedFactorUid || !factors.length) return;
    const factor = factors.find(
      (candidate) => candidate.uid === selectedFactorUid,
    );
    if (!factor || (factor.factorId === "phone" && !recaptchaContainer.current))
      return;
    const attemptId = `${selectedFactorUid}:${factorAttempt}`;
    if (startAttempt.current === attemptId) return;
    startAttempt.current = attemptId;
    setChallengeStarted(false);
    setCode("");
    setError(null);
    void client
      .startSecondFactor(
        selectedFactorUid,
        factor.factorId === "phone" ? recaptchaContainer.current : null,
      )
      .then(() => setChallengeStarted(true))
      .catch(() => {
        startAttempt.current = null;
        setError(webMessages.adminMfaChallengeError);
      });
  }, [client, factorAttempt, factors, selectedFactorUid]);

  useEffect(() => () => client.cancelSecondFactor(), [client]);

  const brand = <AdminBrand serviceName={serviceName} />;

  if (state.status === "authorized") {
    return <Navigate to="/admin/customers" replace />;
  }
  if (
    state.status === "loading" ||
    state.status === "verifying" ||
    mfaCompleted
  ) {
    return (
      <Page>
        <output className="ui-lead">{webMessages.sessionLoading}</output>
      </Page>
    );
  }
  if (state.status === "denied") {
    return (
      <AdminAuthFrame brand={brand} badge={webMessages.adminBadge}>
        <h1 id="admin-login-title">{webMessages.adminLoginTitle}</h1>
        <Notice tone="warn">{state.message}</Notice>
        <AdminLogoutButton />
      </AdminAuthFrame>
    );
  }

  function chooseFactor(uid: string) {
    setError(null);
    setChallengeStarted(false);
    setCode("");
    setSelectedFactorUid(uid);
    setFactorAttempt((attempt) => attempt + 1);
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await client.signIn(email.trim(), password);
      setPassword("");
      if (result.status === "mfa_required") {
        if (result.factors.length === 0) {
          setError(webMessages.adminMfaChallengeError);
          return;
        }
        setFactors(result.factors);
        const initial = result.factors[0];
        if (initial) setSelectedFactorUid(initial.uid);
      }
    } catch (caught) {
      setPassword("");
      setError(
        caught instanceof AdminAuthClientError &&
          caught.code === "unsupported_factor"
          ? webMessages.adminMfaChallengeError
          : webMessages.loginError,
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!/^\d{6}$/.test(code)) {
      setError(webMessages.adminMfaInvalidCode);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await client.completeSecondFactor(selectedFactorUid, code);
      setCode("");
      setMfaCompleted(true);
    } catch {
      setError(webMessages.adminMfaInvalidCode);
    } finally {
      setSubmitting(false);
    }
  }

  function cancelChallenge() {
    client.cancelSecondFactor();
    setFactorAttempt((attempt) => attempt + 1);
    setFactors([]);
    setSelectedFactorUid("");
    setChallengeStarted(false);
    setCode("");
    setError(null);
  }

  const selectedFactor = factors.find(
    (factor) => factor.uid === selectedFactorUid,
  );
  return (
    <AdminAuthFrame brand={brand} badge={webMessages.adminBadge}>
      <h1 id="admin-login-title">
        {factors.length
          ? webMessages.adminMfaChallengeTitle
          : webMessages.adminLoginTitle}
      </h1>
      <Hint>
        {factors.length
          ? webMessages.adminMfaDescription
          : webMessages.adminLoginDescription}
      </Hint>
      {!factors.length ? (
        <form onSubmit={(event) => void submitCredentials(event)}>
          <Field label={webMessages.emailLabel}>
            <input
              autoComplete="username"
              name="admin-email"
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
              type="email"
              value={email}
            />
          </Field>
          <Field label={webMessages.passwordLabel}>
            <input
              autoComplete="current-password"
              name="admin-password"
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
              type="password"
              value={password}
            />
          </Field>
          {error ? <Notice tone="warn">{error}</Notice> : null}
          <Button variant="dark" disabled={submitting} type="submit">
            {submitting
              ? webMessages.loginSubmitting
              : webMessages.adminLoginButton}
          </Button>
        </form>
      ) : (
        <form onSubmit={(event) => void submitCode(event)}>
          {factors.length > 1 ? (
            <Field label={webMessages.adminMfaFactorPrompt}>
              <select
                onChange={(event) => chooseFactor(event.currentTarget.value)}
                value={selectedFactorUid}
              >
                {factors.map((factor) => (
                  <option key={factor.uid} value={factor.uid}>
                    {factor.displayName || adminMfaFactorLabel(factor.factorId)}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <div
            aria-hidden="true"
            className="ui-admin-auth__recaptcha"
            ref={recaptchaContainer}
          />
          <Field
            label={
              selectedFactor
                ? adminMfaFactorLabel(selectedFactor.factorId)
                : webMessages.adminMfaCodeLabel
            }
          >
            <input
              autoComplete="one-time-code"
              className="ui-input--otp"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) =>
                setCode(
                  event.currentTarget.value.replace(/\D/g, "").slice(0, 6),
                )
              }
              pattern="[0-9]{6}"
              required
              type="text"
              value={code}
            />
          </Field>
          {error ? <Notice tone="warn">{error}</Notice> : null}
          <ActionBar>
            {!challengeStarted && error ? (
              <Button
                variant="ghost"
                onClick={() => chooseFactor(selectedFactorUid)}
              >
                {webMessages.retry}
              </Button>
            ) : null}
            <Button
              variant="dark"
              disabled={submitting || !challengeStarted}
              type="submit"
            >
              {submitting
                ? webMessages.loginSubmitting
                : webMessages.adminMfaCodeSubmit}
            </Button>
            <Button variant="ghost" onClick={cancelChallenge}>
              {webMessages.adminDeclineCancel}
            </Button>
          </ActionBar>
        </form>
      )}
    </AdminAuthFrame>
  );
}
