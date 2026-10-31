import { webMessages } from "@kobito/shared";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAdminAuth } from "../auth/admin-session.js";
import { AdminAuthClientError } from "../auth/firebase-admin-client.js";
import {
  AdminAuthFrame,
  AdminBrand,
  Button,
  Field,
  Hint,
  Notice,
} from "../ui/index.js";

export function AdminEnrollPage({ serviceName }: { serviceName: string }) {
  const { client } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<{
    secret: string;
    uri: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => client.clearTotpEnrollment(), [client]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.signIn(email.trim(), password);
      setPassword("");
      if (result.status === "mfa_required") {
        setError(webMessages.adminEnrollAlreadyRegistered);
        return;
      }
      setChallenge(await client.startTotpEnrollment(serviceName));
    } catch (caught) {
      setPassword("");
      if (caught instanceof AdminAuthClientError) {
        setError(
          caught.code === "already_enrolled"
            ? webMessages.adminEnrollAlreadyRegistered
            : caught.code === "reauth_required"
              ? webMessages.adminEnrollRelogin
              : caught.code === "mfa_unavailable"
                ? webMessages.adminEnrollMfaUnavailable
                : webMessages.adminEnrollStartError,
        );
      } else {
        setError(webMessages.adminEnrollStartError);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || busy) return;
    if (!/^\d{6}$/.test(code)) {
      setError(webMessages.adminEnrollWrongCode);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.completeTotpEnrollment(challenge.secret, code);
      client.clearTotpEnrollment();
      setChallenge(null);
      setCode("");
      setComplete(true);
    } catch (caught) {
      const code = (caught as { code?: string })?.code;
      setError(
        (caught instanceof AdminAuthClientError &&
          caught.code === "reauth_required") ||
          code === "auth/requires-recent-login"
          ? webMessages.adminEnrollRelogin
          : [
                "auth/multi-factor-auth-not-enabled",
                "auth/operation-not-allowed",
              ].includes(code ?? "")
            ? webMessages.adminEnrollMfaUnavailable
            : webMessages.adminEnrollWrongCode,
      );
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    await client.signOut();
  }

  return (
    <AdminAuthFrame
      brand={<AdminBrand serviceName={serviceName} />}
      badge={webMessages.adminBadge}
    >
      <h1>{webMessages.adminEnrollTitle}</h1>
      <Hint>{webMessages.adminEnrollDescription}</Hint>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {complete ? (
        <>
          <Notice tone="info" live>
            {webMessages.adminEnrollSuccess}
          </Notice>
          <Button variant="dark" onClick={() => void finish()}>
            {webMessages.adminEnrollSignOut}
          </Button>
        </>
      ) : challenge ? (
        <>
          <Hint>{webMessages.adminEnrollManual}</Hint>
          <Field label={webMessages.adminEnrollSecret}>
            <code>{challenge.secret}</code>
          </Field>
          <Field label={webMessages.adminEnrollUri}>
            <code>{challenge.uri}</code>
          </Field>
          <form onSubmit={(event) => void submit(event)}>
            <Field label={webMessages.adminEnrollCode}>
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setCode(event.currentTarget.value)}
                pattern="[0-9]{6}"
                required
                value={code}
              />
            </Field>
            <Button variant="dark" disabled={busy} type="submit">
              {busy
                ? webMessages.loginSubmitting
                : webMessages.adminEnrollSubmit}
            </Button>
          </form>
        </>
      ) : (
        <form onSubmit={(event) => void start(event)}>
          <Field label={webMessages.emailLabel}>
            <input
              autoComplete="username"
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
              type="email"
              value={email}
            />
          </Field>
          <Field label={webMessages.passwordLabel}>
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
              type="password"
              value={password}
            />
          </Field>
          <Button variant="dark" disabled={busy} type="submit">
            {busy ? webMessages.loginSubmitting : webMessages.adminEnrollStart}
          </Button>
        </form>
      )}
      <p>
        <Link to="/admin/login">{webMessages.adminLoginTitle}</Link>
      </p>
    </AdminAuthFrame>
  );
}
