import { webMessages } from "@kobito/shared";
import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import type { AuthClient } from "../auth/session.js";
import { useAuthSession } from "../auth/session.js";
import { MailText } from "../platform/contact.js";
import {
  Button,
  buttonClass,
  Field,
  Hint,
  Lead,
  Notice,
  Page,
  Title,
} from "../ui/index.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUserNotFound(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: unknown }).code === "auth/user-not-found"
  );
}

export function LoginPage({
  authClient,
  lineLiffId,
}: {
  authClient: AuthClient;
  lineLiffId?: string | undefined;
}) {
  const { state } = useAuthSession();
  const location = useLocation();
  const returnTo =
    new URLSearchParams(location.search).get("next") === "apply"
      ? "/apply/shop"
      : "/me";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSending, setResetSending] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetFieldError, setResetFieldError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);

  if (state.status === "authenticated") {
    return <Navigate to={returnTo} replace />;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await authClient.signIn(email.trim(), password);
      setPassword("");
    } catch {
      setError(webMessages.loginError);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resetSending) return;
    const target = resetEmail.trim();
    setResetError(null);
    setResetDone(false);
    if (!EMAIL_PATTERN.test(target)) {
      setResetFieldError(webMessages.passwordResetInvalidEmail);
      return;
    }
    setResetFieldError(null);
    setResetSending(true);
    try {
      await authClient.sendPasswordReset(target);
      setResetDone(true);
    } catch (cause) {
      // 登録の有無を漏らさないため、未登録でも成功と同じ表示にする
      if (isUserNotFound(cause)) setResetDone(true);
      else setResetError(webMessages.passwordResetError);
    } finally {
      setResetSending(false);
    }
  }

  if (resetting) {
    return (
      <Page>
        <section aria-labelledby="login-title">
          <Title id="login-title">{webMessages.loginForgotLink}</Title>
          <Lead>{webMessages.passwordResetDescription}</Lead>
          <form onSubmit={submitReset} noValidate>
            <Field
              label={webMessages.emailLabel}
              error={resetFieldError ?? undefined}
            >
              <input
                autoComplete="email"
                name="reset-email"
                onChange={(event) => setResetEmail(event.currentTarget.value)}
                type="email"
                value={resetEmail}
              />
            </Field>
            {resetDone ? (
              <Notice tone="info" live>
                {webMessages.passwordResetDone}
              </Notice>
            ) : null}
            {resetError ? <Notice tone="warn">{resetError}</Notice> : null}
            <Button disabled={resetSending} type="submit">
              {resetSending
                ? webMessages.passwordResetSubmitting
                : webMessages.passwordResetButton}
            </Button>
          </form>
          <div className="ui-actions">
            <Button variant="ghost" onClick={() => setResetting(false)}>
              {webMessages.passwordResetCancel}
            </Button>
          </div>
          <Hint align="center">
            <MailText template={webMessages.loginForgotPassword} />
          </Hint>
        </section>
      </Page>
    );
  }

  return (
    <Page>
      <section aria-labelledby="login-title">
        <Title id="login-title">{webMessages.loginTitle}</Title>
        <Lead>{webMessages.loginDescription}</Lead>
        <form onSubmit={submit} noValidate={false}>
          <Field label={webMessages.emailLabel}>
            <input
              autoComplete="username"
              name="email"
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
              type="email"
              value={email}
            />
          </Field>
          <Field label={webMessages.passwordLabel}>
            <input
              autoComplete="current-password"
              name="password"
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
              type="password"
              value={password}
            />
          </Field>
          {error ? <Notice tone="warn">{error}</Notice> : null}
          <Button disabled={submitting} type="submit">
            {submitting ? webMessages.loginSubmitting : webMessages.loginButton}
          </Button>
        </form>
        <div className="ui-actions">
          <Button variant="ghost" onClick={() => setResetting(true)}>
            {webMessages.loginForgotLink}
          </Button>
        </div>
        <Hint align="center">
          <MailText template={webMessages.loginForgotPassword} />
        </Hint>
        {lineLiffId ? (
          <div className="ui-actions">
            <Link className={buttonClass("ghost")} to="/liff?to=home">
              {webMessages.lineLogin}
            </Link>
          </div>
        ) : null}
      </section>
    </Page>
  );
}
