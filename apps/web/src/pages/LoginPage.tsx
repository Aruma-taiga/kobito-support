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
