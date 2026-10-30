import { webMessages } from "@kobito/shared";
import { type FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { AuthClient } from "../auth/session.js";
import { useAuthSession } from "../auth/session.js";

export function LoginPage({ authClient }: { authClient: AuthClient }) {
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
    <main className="page-main">
      <section className="card login-card" aria-labelledby="login-title">
        <h1 id="login-title">{webMessages.loginTitle}</h1>
        <p className="muted-text">{webMessages.loginDescription}</p>
        <form onSubmit={submit} noValidate={false}>
          <label className="field-label" htmlFor="login-email">
            {webMessages.emailLabel}
          </label>
          <input
            autoComplete="username"
            id="login-email"
            name="email"
            onChange={(event) => setEmail(event.currentTarget.value)}
            required
            type="email"
            value={email}
          />
          <label className="field-label" htmlFor="login-password">
            {webMessages.passwordLabel}
          </label>
          <input
            autoComplete="current-password"
            id="login-password"
            name="password"
            onChange={(event) => setPassword(event.currentTarget.value)}
            required
            type="password"
            value={password}
          />
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="primary-button"
            disabled={submitting}
            type="submit"
          >
            {submitting ? webMessages.loginSubmitting : webMessages.loginButton}
          </button>
        </form>
      </section>
    </main>
  );
}
