import { contractStatusLabels, webMessages } from "@kobito/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import {
  type AdminAuthClient,
  AdminAuthProvider,
  type AdminFactorId,
  AdminLogoutButton,
  RequireAdminAuth,
  useAdminAuth,
} from "../auth/admin-session.js";
import { AdminAuthClientError } from "../auth/firebase-admin-client.js";
import type { AdminApiClient } from "../platform/admin-api-client.js";

export type { AdminApiClient } from "../platform/admin-api-client.js";

function formatJstDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function formatPaymentMethod(method: string): string {
  if (method === "bank_transfer") return webMessages.applicationBankTransfer;
  if (method === "card") return webMessages.applicationCardPayment;
  if (method === "konbini") return webMessages.applicationKonbiniPayment;
  return "";
}

function formatPlanSummary(
  name: string,
  priceInclTax: number | null,
  credits: number | null,
): string {
  if (priceInclTax === null || credits === null) {
    return `${name}：${webMessages.applicationCustomQuoteAfterReview}`;
  }
  return webMessages.adminQueuePlanSummaryFixed
    .replace("{name}", name)
    .replace("{price}", priceInclTax.toLocaleString("ja-JP"))
    .replace("{credits}", String(credits));
}

function adminMfaFactorLabel(factorId: AdminFactorId): string {
  return factorId === "phone"
    ? webMessages.adminMfaSmsCodeLabel
    : webMessages.adminMfaTotpCodeLabel;
}

function AdminLoginPage() {
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

  if (state.status === "authorized") {
    return <Navigate to="/admin/customers" replace />;
  }
  if (state.status === "loading" || state.status === "verifying") {
    return (
      <output className="status-message">{webMessages.sessionLoading}</output>
    );
  }
  if (state.status === "denied") {
    return (
      <main className="page-main">
        <section
          className="card admin-card admin-login-card"
          aria-labelledby="admin-login-title"
        >
          <h1 id="admin-login-title">{webMessages.adminLoginTitle}</h1>
          <p className="error-message" role="alert">
            {state.message}
          </p>
          <AdminLogoutButton />
        </section>
      </main>
    );
  }
  if (mfaCompleted) {
    return (
      <output className="status-message">{webMessages.sessionLoading}</output>
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
    <main className="page-main">
      <section
        className="card admin-card admin-login-card"
        aria-labelledby="admin-login-title"
      >
        <h1 id="admin-login-title">
          {factors.length
            ? webMessages.adminMfaChallengeTitle
            : webMessages.adminLoginTitle}
        </h1>
        <p className="muted-text">{webMessages.adminLoginDescription}</p>
        {!factors.length ? (
          <form onSubmit={(event) => void submitCredentials(event)}>
            <label className="field-label" htmlFor="admin-email">
              {webMessages.emailLabel}
            </label>
            <input
              autoComplete="username"
              id="admin-email"
              name="admin-email"
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
              type="email"
              value={email}
            />
            <label className="field-label" htmlFor="admin-password">
              {webMessages.passwordLabel}
            </label>
            <input
              autoComplete="current-password"
              id="admin-password"
              name="admin-password"
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
              {submitting
                ? webMessages.loginSubmitting
                : webMessages.adminLoginButton}
            </button>
          </form>
        ) : (
          <form onSubmit={(event) => void submitCode(event)}>
            {factors.length > 1 ? (
              <div className="admin-field">
                <label className="field-label" htmlFor="admin-factor">
                  {webMessages.adminMfaFactorPrompt}
                </label>
                <select
                  id="admin-factor"
                  onChange={(event) => chooseFactor(event.currentTarget.value)}
                  value={selectedFactorUid}
                >
                  {factors.map((factor) => (
                    <option key={factor.uid} value={factor.uid}>
                      {factor.displayName ||
                        adminMfaFactorLabel(factor.factorId)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div
              aria-hidden="true"
              className="admin-recaptcha-container"
              ref={recaptchaContainer}
            />
            <label className="field-label" htmlFor="admin-mfa-code">
              {selectedFactor
                ? adminMfaFactorLabel(selectedFactor.factorId)
                : webMessages.adminMfaCodeLabel}
            </label>
            <input
              autoComplete="one-time-code"
              id="admin-mfa-code"
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
            {error ? (
              <p className="error-message" role="alert">
                {error}
              </p>
            ) : null}
            <div className="admin-actions">
              {!challengeStarted && error ? (
                <button
                  className="secondary-button"
                  onClick={() => chooseFactor(selectedFactorUid)}
                  type="button"
                >
                  {webMessages.retry}
                </button>
              ) : null}
              <button
                className="primary-button"
                disabled={submitting || !challengeStarted}
                type="submit"
              >
                {submitting
                  ? webMessages.loginSubmitting
                  : webMessages.adminMfaCodeSubmit}
              </button>
              <button
                className="secondary-button"
                onClick={cancelChallenge}
                type="button"
              >
                {webMessages.adminDeclineCancel}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

function AdminQueuePage({ apiClient }: { apiClient: AdminApiClient }) {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<Awaited<
    ReturnType<AdminApiClient["getApplications"]>
  > | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void apiClient
      .getApplications({ status: "under_review", q: query, page, pageSize: 25 })
      .then((response) => {
        if (active) setResult(response);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiClient, page, query]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQuery(searchInput.trim());
  }

  const totalPages = result
    ? Math.max(1, Math.ceil(result.total / result.pageSize))
    : 1;
  return (
    <main className="page-main">
      <section className="card admin-card" aria-labelledby="admin-queue-title">
        <h1 id="admin-queue-title">{webMessages.adminQueueTitle}</h1>
        <form className="admin-search" onSubmit={search}>
          <label className="field-label" htmlFor="admin-queue-search">
            {webMessages.adminSearchLabel}
          </label>
          <input
            id="admin-queue-search"
            maxLength={100}
            onChange={(event) => setSearchInput(event.currentTarget.value)}
            type="search"
            value={searchInput}
          />
          <button className="secondary-button" type="submit">
            {webMessages.adminSearchButton}
          </button>
        </form>
        {loading ? (
          <output className="status-message">
            {webMessages.adminQueueLoading}
          </output>
        ) : null}
        {error ? (
          <p className="error-message" role="alert">
            {webMessages.adminRequestError}
          </p>
        ) : null}
        {!loading && !error && result?.items.length === 0 ? (
          <p className="muted-text">{webMessages.adminQueueEmpty}</p>
        ) : null}
        {!loading && !error && result?.items.length ? (
          <div className="admin-queue-list">
            {result.items.map((item) => (
              <article className="admin-queue-item" key={item.customerId}>
                <Link
                  className="admin-queue-link"
                  to={`/admin/customers/${encodeURIComponent(item.customerId)}`}
                >
                  <strong>{item.shopName}</strong>
                  <span>
                    {item.contactName} · {item.email}
                  </span>
                </Link>
                <dl>
                  <dt>{webMessages.adminSubmittedAt}</dt>
                  <dd>{formatJstDate(item.submittedAt)}</dd>
                  <dt>{webMessages.adminPlan}</dt>
                  <dd>
                    {formatPlanSummary(
                      item.planName,
                      item.priceInclTax,
                      item.credits,
                    )}
                  </dd>
                  <dt>{webMessages.adminPaymentMethod}</dt>
                  <dd>{formatPaymentMethod(item.paymentMethod)}</dd>
                  <dt>{webMessages.adminDetailTitle}</dt>
                  <dd>{contractStatusLabels[item.status]}</dd>
                </dl>
              </article>
            ))}
          </div>
        ) : null}
        {result ? (
          <nav
            className="admin-pagination"
            aria-label={webMessages.adminQueueTitle}
          >
            <button
              className="secondary-button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => current - 1)}
              type="button"
            >
              {webMessages.adminPreviousPage}
            </button>
            <span>
              {result.page} / {totalPages}
            </span>
            <button
              className="secondary-button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
              type="button"
            >
              {webMessages.adminNextPage}
            </button>
          </nav>
        ) : null}
      </section>
    </main>
  );
}

function AdminCustomerPage({ apiClient }: { apiClient: AdminApiClient }) {
  const { id = "" } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [data, setData] = useState<Awaited<
    ReturnType<AdminApiClient["getCustomerDetail"]>
  > | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [rejectionNote, setRejectionNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [declineSuccess, setDeclineSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void apiClient
      .getCustomerDetail(id)
      .then((response) => {
        if (active) setData(response);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiClient, id]);

  async function decline() {
    if (!data || declining || data.contract.status !== "under_review") return;
    setDeclining(true);
    setDeclineError(null);
    try {
      const response = await apiClient.declineApplication(data.application.id, {
        ...(rejectionNote.trim()
          ? { rejectionNote: rejectionNote.trim() }
          : {}),
      });
      setData((current) =>
        current
          ? {
              ...current,
              application: {
                ...current.application,
                reviewResult: "declined",
                rejectionNote: rejectionNote.trim() || null,
              },
              contract: { ...current.contract, status: response.status },
            }
          : current,
      );
      setDeclineOpen(false);
      setDeclineSuccess(true);
    } catch (caught) {
      setDeclineError(
        (caught as { code?: string })?.code === "conflict"
          ? webMessages.adminApplicationConflict
          : webMessages.adminDeclineError,
      );
    } finally {
      setDeclining(false);
    }
  }

  if (loading)
    return (
      <main className="page-main">
        <output className="status-message">
          {webMessages.adminQueueLoading}
        </output>
      </main>
    );
  if (error || !data)
    return (
      <main className="page-main">
        <section className="card admin-card">
          <p className="error-message" role="alert">
            {webMessages.adminQueueError}
          </p>
          <Link to="/admin/customers">{webMessages.adminQueueTitle}</Link>
        </section>
      </main>
    );

  const terms = data.application.shownTerms;
  const planName = typeof terms.planName === "string" ? terms.planName : "";
  const price =
    typeof terms.priceInclTax === "number" ? terms.priceInclTax : null;
  const credits = typeof terms.credits === "number" ? terms.credits : null;
  const paymentMethod =
    typeof terms.paymentMethod === "string"
      ? formatPaymentMethod(terms.paymentMethod)
      : "";
  const canDecline =
    data.contract.status === "under_review" &&
    data.application.reviewResult === null;

  return (
    <main className="page-main">
      <section className="card admin-card" aria-labelledby="admin-detail-title">
        <Link className="admin-back-link" to="/admin/customers">
          {webMessages.adminQueueTitle}
        </Link>
        <h1 id="admin-detail-title">{webMessages.adminDetailTitle}</h1>
        <dl className="admin-detail-list">
          <dt>{webMessages.applicationShopHeading}</dt>
          <dd>{data.customer.shopName}</dd>
          <dt>{webMessages.applicationContactName}</dt>
          <dd>{data.customer.contactName}</dd>
          <dt>{webMessages.emailLabel}</dt>
          <dd>{data.customer.email}</dd>
          {data.customer.phone ? (
            <>
              <dt>{webMessages.applicationPhone}</dt>
              <dd>{data.customer.phone}</dd>
            </>
          ) : null}
          <dt>{webMessages.adminSubmittedAt}</dt>
          <dd>{formatJstDate(data.application.submittedAt)}</dd>
          <dt>{webMessages.adminPlan}</dt>
          <dd>{formatPlanSummary(planName, price, credits)}</dd>
          {paymentMethod ? (
            <>
              <dt>{webMessages.adminPaymentMethod}</dt>
              <dd>{paymentMethod}</dd>
            </>
          ) : null}
          <dt>{webMessages.adminBillingDetails}</dt>
          <dd>
            {data.customer.billingName}
            <br />
            {data.customer.billingAddress}
          </dd>
          {data.customer.invoiceRegistrationNo ? (
            <>
              <dt>{webMessages.applicationInvoiceRegistrationNo}</dt>
              <dd>{data.customer.invoiceRegistrationNo}</dd>
            </>
          ) : null}
          <dt>{webMessages.adminStatusLabel}</dt>
          <dd>{contractStatusLabels[data.contract.status]}</dd>
          <dt>{webMessages.applicationTermsVersion}</dt>
          <dd>{data.application.termsVersion}</dd>
          <dt>{webMessages.applicationPrivacyVersion}</dt>
          <dd>{data.application.privacyVersion}</dd>
          <dt>{webMessages.applicationDisclosureVersion}</dt>
          <dd>{data.application.disclosureVersion}</dd>
          {data.application.referralCode ? (
            <>
              <dt>{webMessages.applicationReferralCode}</dt>
              <dd>{data.application.referralCode}</dd>
            </>
          ) : null}
        </dl>
        <section
          className="admin-consent-list"
          aria-labelledby="admin-consent-title"
        >
          <h2 id="admin-consent-title">{webMessages.adminConsentSummary}</h2>
          <label>
            <input
              checked={data.application.consentBusinessUse}
              disabled
              type="checkbox"
            />
            {webMessages.applicationConsentBusiness}
          </label>
          <label>
            <input
              checked={data.application.consentTerms}
              disabled
              type="checkbox"
            />
            {webMessages.applicationConsentTerms}
          </label>
          <label>
            <input
              checked={data.application.consentMarketing}
              disabled
              type="checkbox"
            />
            {webMessages.applicationConsentMarketing}
          </label>
          {data.application.consentPartnerShare !== null ? (
            <label>
              <input
                checked={data.application.consentPartnerShare}
                disabled
                type="checkbox"
              />
              {webMessages.applicationConsentPartner}
            </label>
          ) : null}
        </section>
        {data.application.freeText ? (
          <section className="admin-note" aria-labelledby="admin-notes-title">
            <h2 id="admin-notes-title">{webMessages.adminNotesHeading}</h2>
            <p>{data.application.freeText}</p>
          </section>
        ) : null}
        {data.application.rejectionNote ? (
          <p>{data.application.rejectionNote}</p>
        ) : null}
        {declineSuccess ? (
          <output className="notice info">
            {webMessages.adminDeclineSuccess}
          </output>
        ) : null}
        {declineError ? (
          <p className="error-message" role="alert">
            {declineError}
          </p>
        ) : null}
        {canDecline && !declineOpen ? (
          <button
            className="secondary-button"
            onClick={() => setDeclineOpen(true)}
            type="button"
          >
            {webMessages.adminDecline}
          </button>
        ) : null}
        {canDecline && declineOpen ? (
          <section
            className="admin-decline"
            aria-labelledby="admin-decline-confirm"
          >
            <h2 id="admin-decline-confirm">
              {webMessages.adminDeclineConfirm}
            </h2>
            <label className="field-label" htmlFor="admin-rejection-note">
              {webMessages.adminDeclineReason}
            </label>
            <textarea
              id="admin-rejection-note"
              maxLength={500}
              onChange={(event) => setRejectionNote(event.currentTarget.value)}
              value={rejectionNote}
            />
            <div className="admin-actions">
              <button
                className="primary-button"
                disabled={declining}
                onClick={() => void decline()}
                type="button"
              >
                {declining
                  ? webMessages.adminDeclineWorking
                  : webMessages.adminDeclineConfirmButton}
              </button>
              <button
                className="secondary-button"
                disabled={declining}
                onClick={() => setDeclineOpen(false)}
                type="button"
              >
                {webMessages.adminDeclineCancel}
              </button>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

export function AdminApp({
  authClient,
  apiClient,
}: {
  authClient: AdminAuthClient;
  apiClient: AdminApiClient;
}) {
  return (
    <AdminAuthProvider client={authClient} apiClient={apiClient}>
      <Routes>
        <Route path="login" element={<AdminLoginPage />} />
        <Route element={<RequireAdminAuth />}>
          <Route index element={<Navigate to="/admin/customers" replace />} />
          <Route
            path="customers"
            element={<AdminQueuePage apiClient={apiClient} />}
          />
          <Route
            path="customers/:id"
            element={<AdminCustomerPage apiClient={apiClient} />}
          />
        </Route>
        <Route path="*" element={<Navigate to="/admin/login" replace />} />
      </Routes>
    </AdminAuthProvider>
  );
}
