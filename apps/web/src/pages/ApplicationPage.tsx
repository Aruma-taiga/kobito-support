import {
  type ApplicationReceipt,
  applicationFormSchema,
  applicationSubmissionSchema,
  authenticatedApplicationFormSchema,
  authenticatedShopStepSchema,
  inclYenFor,
  notesStepSchema,
  type PublicConfig,
  type PublicPartner,
  type PublicPlans,
  paymentStepSchema,
  planStepSchema,
  shopStepSchema,
  webMessages,
} from "@kobito/shared";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AuthClient, AuthUser } from "../auth/session.js";
import { useAuthSession } from "../auth/session.js";
import { ApiClientError } from "../platform/api-client.js";
import { useContact } from "../platform/contact.js";

type ApiClient = {
  getPublicConfig(): Promise<PublicConfig>;
  getPublicPlans(): Promise<PublicPlans>;
  getPublicPartner(code: string): Promise<PublicPartner>;
  postApplication(
    payload: unknown,
    idempotencyKey: string,
  ): Promise<ApplicationReceipt>;
};
type Draft = {
  shopName: string;
  contactName: string;
  email: string;
  phone: string;
  password: string;
  planCode: string;
  billingName: string;
  billingAddress: string;
  paymentMethod: string;
  invoiceRegistrationNo: string;
  lineDisplayName: string;
  referralCode: string;
  freeText: string;
  consentBusinessUse: boolean;
  consentTerms: boolean;
  consentPartnerShare: boolean;
  consentMarketing: boolean;
};

function formatMonthlyPrice(priceExclTax: number | null) {
  if (priceExclTax === null) return null;
  return (
    <>
      <span className="choice-price-segment">
        {webMessages.applicationPlanChoiceExclPrice.replace(
          "{price}",
          priceExclTax.toLocaleString("ja-JP"),
        )}
      </span>
      <small className="choice-price-segment">
        {webMessages.applicationPlanChoiceInclPrice.replace(
          "{price}",
          inclYenFor(priceExclTax).toLocaleString("ja-JP"),
        )}
      </small>
    </>
  );
}

const emptyDraft: Draft = {
  shopName: "",
  contactName: "",
  email: "",
  phone: "",
  password: "",
  planCode: "",
  billingName: "",
  billingAddress: "",
  paymentMethod: "",
  invoiceRegistrationNo: "",
  lineDisplayName: "",
  referralCode: "",
  freeText: "",
  consentBusinessUse: false,
  consentTerms: false,
  consentPartnerShare: false,
  consentMarketing: false,
};
const stepPaths = [
  "/apply/shop",
  "/apply/plan",
  "/apply/payment",
  "/apply/notes",
  "/apply/confirm",
  "/apply/done",
] as const;
const stepNames = [
  webMessages.applicationProgressShop,
  webMessages.applicationProgressPlan,
  webMessages.applicationProgressPayment,
  webMessages.applicationProgressNotes,
  webMessages.applicationProgressConfirm,
];

function stepIndex(path: string): number {
  return stepPaths.indexOf(path as (typeof stepPaths)[number]);
}
function genericValidationError(): string {
  return webMessages.applicationValidationError;
}
function stepValue(
  index: number,
  value: Draft,
  isAuthenticated: boolean,
): unknown {
  if (index === 0) {
    const { shopName, contactName, email, phone, password } = value;
    return isAuthenticated
      ? { shopName, contactName, email, phone }
      : { shopName, contactName, email, phone, password };
  }
  if (index === 1) return { planCode: value.planCode };
  if (index === 2)
    return {
      billingName: value.billingName,
      billingAddress: value.billingAddress,
      paymentMethod: value.paymentMethod,
      invoiceRegistrationNo: value.invoiceRegistrationNo,
    };
  return {
    lineDisplayName: value.lineDisplayName,
    referralCode: value.referralCode,
    freeText: value.freeText,
  };
}

export function ApplicationPage({
  apiClient,
  authClient,
}: {
  apiClient: ApiClient;
  authClient: AuthClient;
}) {
  const { state: session } = useAuthSession();
  const { lineEnabled } = useContact();
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [plans, setPlans] = useState<PublicPlans | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [conditionsChanged, setConditionsChanged] = useState(false);
  const [verifiedPartner, setVerifiedPartner] = useState<PublicPartner | null>(
    null,
  );
  const [referralInvalid, setReferralInvalid] = useState(false);
  const [validatingReferral, setValidatingReferral] = useState(false);
  const receiptRef = useRef<ApplicationReceipt | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const renewKeyAfterOfferChange = useRef(false);
  const referralPrefilled = useRef(false);
  const referralCheckSequence = useRef(0);
  const authenticatedUser: AuthUser | null =
    session.status === "authenticated"
      ? session.user
      : authClient.currentUser();
  const isAuthenticated = authenticatedUser !== null;
  const policy = config?.application ?? null;
  const activeStep = stepIndex(location.pathname);

  const loadPublicData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [configResult, plansResult] = await Promise.allSettled([
      apiClient.getPublicConfig(),
      apiClient.getPublicPlans(),
    ]);
    if (
      configResult.status === "fulfilled" &&
      plansResult.status === "fulfilled"
    ) {
      if (
        configResult.value.application &&
        configResult.value.application.displayVersion !==
          plansResult.value.displayVersion
      ) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      setConfig(configResult.value);
      setPlans(plansResult.value);
      setDraft((current) => {
        const email = authClient.currentUser()?.email;
        return { ...current, email: current.email || email || "" };
      });
    } else setLoadError(true);
    setLoading(false);
  }, [apiClient, authClient]);

  useEffect(() => {
    void loadPublicData();
  }, [loadPublicData]);

  const validateReferral = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      const sequence = ++referralCheckSequence.current;
      if (!code) {
        setVerifiedPartner(null);
        setReferralInvalid(false);
        return true;
      }
      setValidatingReferral(true);
      setVerifiedPartner(null);
      setReferralInvalid(false);
      try {
        const partner = await apiClient.getPublicPartner(code);
        if (partner.code !== code) throw new Error("invalid_partner");
        if (sequence !== referralCheckSequence.current) return false;
        setVerifiedPartner(partner);
        setReferralInvalid(false);
        return true;
      } catch {
        if (sequence !== referralCheckSequence.current) return false;
        setReferralInvalid(true);
        return false;
      } finally {
        setValidatingReferral(false);
      }
    },
    [apiClient],
  );

  useEffect(() => {
    if (referralPrefilled.current) return;
    referralPrefilled.current = true;
    const referralCode = new URLSearchParams(location.search)
      .get("ref")
      ?.trim();
    if (referralCode) {
      setDraft((current) => ({ ...current, referralCode }));
      void validateReferral(referralCode);
    }
  }, [location.search, validateReferral]);

  useEffect(() => {
    if (session.status === "authenticated" && !draft.email) {
      setDraft((current) =>
        current.email
          ? current
          : { ...current, email: session.user.email ?? "" },
      );
    }
  }, [session, draft.email]);

  useEffect(() => {
    if (location.pathname === "/apply/done" && !receiptRef.current)
      navigate("/apply/shop", { replace: true });
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (receiptRef.current) return;
    if (activeStep < 1 || activeStep > 4) return;
    const validators = [
      isAuthenticated ? authenticatedShopStepSchema : shopStepSchema,
      planStepSchema,
      paymentStepSchema,
      notesStepSchema,
    ];
    for (let i = 0; i < activeStep; i += 1) {
      const validator = validators[i];
      const path = stepPaths[i];
      if (!validator || !path) return;
      const result = validator.safeParse(stepValue(i, draft, isAuthenticated));
      if (!result.success) {
        navigate(path, { replace: true });
        return;
      }
    }
  }, [activeStep, draft, isAuthenticated, navigate]);

  const plan = useMemo(
    () => plans?.plans.find((item) => item.code === draft.planCode),
    [plans, draft.planCode],
  );
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  async function moveNext(index: number) {
    const validators = [
      isAuthenticated ? authenticatedShopStepSchema : shopStepSchema,
      planStepSchema,
      paymentStepSchema,
      notesStepSchema,
    ];
    const validator = validators[index];
    if (!validator) return;
    const result = validator.safeParse(
      stepValue(index, draft, isAuthenticated),
    );
    if (!result.success) {
      setFieldError(genericValidationError());
      return;
    }
    if (
      index === 3 &&
      draft.referralCode.trim() &&
      verifiedPartner?.code !== draft.referralCode.trim()
    ) {
      const valid = await validateReferral(draft.referralCode);
      if (!valid) {
        setFieldError(webMessages.applicationReferralInvalid);
        return;
      }
    }
    setFieldError(null);
    const nextPath = stepPaths[index + 1];
    if (nextPath) navigate(nextPath);
  }
  function movePrevious(index: number) {
    setFieldError(null);
    const previousPath = stepPaths[index - 1];
    if (previousPath) navigate(previousPath);
  }

  async function submit(
    event?: Pick<FormEvent<HTMLFormElement>, "preventDefault">,
  ) {
    event?.preventDefault();
    if (submitting || !policy || !plans || !config) return;
    if (policy.displayVersion !== plans.displayVersion) {
      setSubmitError(webMessages.applicationConditionsChanged);
      return;
    }
    if (
      draft.referralCode.trim() &&
      verifiedPartner?.code !== draft.referralCode.trim()
    ) {
      setReferralInvalid(true);
      setFieldError(webMessages.applicationReferralInvalid);
      navigate("/apply/notes");
      return;
    }
    if (
      !draft.consentBusinessUse ||
      !draft.consentTerms ||
      (Boolean(draft.referralCode.trim()) && !draft.consentPartnerShare)
    )
      return;
    const candidate = {
      shopName: draft.shopName,
      contactName: draft.contactName,
      email: draft.email,
      ...(draft.phone.trim() ? { phone: draft.phone } : {}),
      planCode: draft.planCode,
      billingName: draft.billingName,
      billingAddress: draft.billingAddress,
      paymentMethod: draft.paymentMethod,
      invoiceRegistrationNo: draft.invoiceRegistrationNo,
      lineDisplayName: draft.lineDisplayName,
      referralCode: draft.referralCode,
      freeText: draft.freeText,
      consentBusinessUse: draft.consentBusinessUse,
      consentTerms: draft.consentTerms,
      consentMarketing: draft.consentMarketing,
      consentPartnerShare: draft.consentPartnerShare,
    };
    const formResult = isAuthenticated
      ? authenticatedApplicationFormSchema.safeParse(candidate)
      : applicationFormSchema.safeParse({
          ...candidate,
          password: draft.password,
        });
    if (!formResult.success) {
      setSubmitError(genericValidationError());
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setConditionsChanged(false);
    try {
      let user = authClient.currentUser();
      if (user) {
        if (
          !user.email ||
          user.email.toLowerCase() !== draft.email.trim().toLowerCase()
        )
          throw new Error("email_mismatch");
      } else {
        if (!draft.password) throw new Error("missing_password");
        try {
          user = await authClient.signUp(draft.email.trim(), draft.password);
        } catch (error) {
          if (
            (error as { code?: string })?.code === "auth/email-already-in-use"
          )
            throw new Error("existing_email");
          throw error;
        }
        setDraft((current) => ({ ...current, password: "" }));
        user = authClient.currentUser() ?? user;
        if (
          !user?.email ||
          user.email.toLowerCase() !== draft.email.trim().toLowerCase()
        )
          throw new Error("email_mismatch");
      }
      const formValues = { ...formResult.data } as Record<string, unknown>;
      delete formValues.password;
      const payloadResult = applicationSubmissionSchema.safeParse({
        ...formValues,
        displayVersion: plans.displayVersion,
      });
      if (!payloadResult.success) {
        setSubmitError(genericValidationError());
        return;
      }
      if (renewKeyAfterOfferChange.current) {
        idempotencyKey.current = crypto.randomUUID();
        renewKeyAfterOfferChange.current = false;
      }
      const result = await apiClient.postApplication(
        payloadResult.data,
        idempotencyKey.current,
      );
      receiptRef.current = result;
      setDraft(emptyDraft);
      navigate("/apply/done", { replace: true });
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "conditions_changed"
      ) {
        renewKeyAfterOfferChange.current = true;
        setConditionsChanged(true);
        setSubmitError(webMessages.applicationConditionsChanged);
        setDraft((current) => ({
          ...current,
          consentBusinessUse: false,
          consentTerms: false,
          consentPartnerShare: false,
        }));
        void loadPublicData();
      } else if (
        (error as { message?: string })?.message === "existing_email"
      ) {
        setSubmitError(webMessages.applicationExistingEmail);
        setDraft((current) => ({ ...current, password: "" }));
      } else if (
        error instanceof ApiClientError &&
        error.code === "application_conflict"
      ) {
        setSubmitError(webMessages.applicationAlreadySubmittedGuidance);
      } else if (
        (error as { message?: string })?.message === "email_mismatch"
      ) {
        setSubmitError(webMessages.applicationEmailMismatch);
      } else if (
        (error as { message?: string })?.message === "missing_password"
      ) {
        setSubmitError(webMessages.applicationValidationError);
      } else setSubmitError(webMessages.applicationSubmitError);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading)
    return (
      <main className="page-main">
        <output className="status-message">
          {webMessages.applicationLoading}
        </output>
      </main>
    );
  if (loadError)
    return (
      <main className="page-main">
        <section className="card application-card">
          <p role="alert" className="error-message">
            {webMessages.applicationLoadError}
          </p>
          <button
            className="secondary-button"
            onClick={() => void loadPublicData()}
            type="button"
          >
            {webMessages.retry}
          </button>
        </section>
      </main>
    );
  if (session.status === "loading" && !authClient.currentUser())
    return (
      <main className="page-main">
        <output className="status-message">{webMessages.sessionLoading}</output>
      </main>
    );
  if (activeStep < 0) return null;
  if (activeStep === 5)
    return receiptRef.current ? (
      <main className="page-main">
        <section className="card application-card receipt-card">
          <div className="done-mark" aria-hidden="true">
            ✓
          </div>
          <h1>{webMessages.applicationReceiptTitle}</h1>
          <p>{webMessages.applicationReceiptDescription}</p>
          <p>{webMessages.applicationContractNotFormed}</p>
          <p className="notice info">{webMessages.applicationReceiptReview}</p>
          <a className="secondary-button application-link" href="/login">
            {webMessages.loginTitle}
          </a>
        </section>
      </main>
    ) : null;
  if (!policy)
    return (
      <main className="page-main">
        <section className="card application-card">
          <h1>{webMessages.applicationUnavailableTitle}</h1>
          <p className="muted-text">
            {webMessages.applicationUnavailableDescription}
          </p>
          <button
            className="secondary-button"
            onClick={() => void loadPublicData()}
            type="button"
          >
            {webMessages.retry}
          </button>
        </section>
      </main>
    );

  const currentVersion =
    plans?.displayVersion === policy.displayVersion
      ? plans.displayVersion
      : null;
  const legalLinks = (
    <span className="legal-links">
      <a href={policy.terms.url} target="_blank" rel="noopener noreferrer">
        {webMessages.applicationTermsLink}
      </a>{" "}
      <a href={policy.privacy.url} target="_blank" rel="noopener noreferrer">
        {webMessages.applicationPrivacyLink}
      </a>{" "}
      <a href={policy.disclosure.url} target="_blank" rel="noopener noreferrer">
        {webMessages.applicationDisclosureLink}
      </a>
    </span>
  );
  const steps = (
    <nav
      className="application-progress"
      aria-label={webMessages.applicationProgressLabel}
    >
      {stepNames.map((name, index) => (
        <div
          className={
            index === activeStep
              ? "current"
              : index < activeStep
                ? "complete"
                : ""
          }
          aria-current={index === activeStep ? "step" : undefined}
          key={name}
        >
          <span>{index + 1}</span>
          {name}
        </div>
      ))}
    </nav>
  );

  return (
    <main className="page-main">
      <section
        className="card application-card"
        aria-labelledby="application-title"
      >
        {policy.mode === "preview" ? (
          <p className="notice yellow">
            {webMessages.applicationPreviewWarning}
          </p>
        ) : null}
        <p className="application-eyebrow">{webMessages.applicationTitle}</p>
        {steps}
        <form
          noValidate
          onSubmit={
            activeStep === 4
              ? submit
              : (event) => {
                  event.preventDefault();
                  void moveNext(activeStep);
                }
          }
        >
          {activeStep === 0 ? (
            <>
              <h1 id="application-title">
                {webMessages.applicationShopHeading}
              </h1>
              <p className="muted-text">{webMessages.applicationDescription}</p>
              <Field
                label={webMessages.shopNameLabel}
                id="application-shop"
                value={draft.shopName}
                onChange={(value) => update("shopName", value)}
                required
              />
              <Field
                label={webMessages.applicationContactName}
                id="application-contact"
                value={draft.contactName}
                onChange={(value) => update("contactName", value)}
                required
              />
              <Field
                label={webMessages.emailLabel}
                id="application-email"
                type="email"
                autoComplete="email"
                value={draft.email}
                onChange={(value) => update("email", value)}
                required
                readOnly={isAuthenticated}
              />
              {isAuthenticated ? (
                <p className="hint">{webMessages.applicationSignedInEmail}</p>
              ) : null}
              <Field
                label={webMessages.applicationPhone}
                id="application-phone"
                type="tel"
                value={draft.phone}
                onChange={(value) => update("phone", value)}
              />
              {!isAuthenticated ? (
                <>
                  <Field
                    label={webMessages.passwordLabel}
                    id="application-password"
                    type="password"
                    autoComplete="new-password"
                    value={draft.password}
                    onChange={(value) => update("password", value)}
                    required
                  />
                  <p className="hint">{webMessages.applicationPasswordHint}</p>
                </>
              ) : null}
            </>
          ) : null}
          {activeStep === 1 ? (
            <>
              <h1 id="application-title">
                {webMessages.applicationPlanHeading}
              </h1>
              <p className="muted-text">
                {webMessages.applicationPlanDescription}
              </p>
              <div className="choice-list">
                {(plans?.plans ?? []).map((item) => (
                  <label
                    className={`choice-card ${draft.planCode === item.code ? "selected" : ""}`}
                    key={item.id}
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={item.code}
                      checked={draft.planCode === item.code}
                      onChange={() => update("planCode", item.code)}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <span className="choice-price">
                        {item.isCustom
                          ? webMessages.applicationCustomPrice
                          : formatMonthlyPrice(item.priceExclTax)}
                      </span>
                      <small>
                        {item.isCustom
                          ? webMessages.applicationCustomDescription
                          : `${item.credits}クレジット / 月`}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <p className="hint">{webMessages.applicationPlanPriceHint}</p>
            </>
          ) : null}
          {activeStep === 2 ? (
            <>
              <h1 id="application-title">
                {webMessages.applicationPaymentHeading}
              </h1>
              <p className="muted-text">
                {webMessages.applicationPaymentDescription}
              </p>
              <fieldset className="field-group">
                <legend>{webMessages.applicationPaymentMethod}</legend>
                <label className="choice-card selected">
                  <input
                    type="radio"
                    name="payment"
                    checked={draft.paymentMethod === "bank_transfer"}
                    onChange={() => update("paymentMethod", "bank_transfer")}
                  />
                  <span>
                    <strong>{webMessages.applicationBankTransfer}</strong>
                    <small>
                      {webMessages.applicationBankTransferDescription}
                    </small>
                  </span>
                </label>
                <label className="choice-card disabled">
                  <input type="radio" disabled />
                  <span>
                    <strong>{webMessages.applicationCardPayment}</strong>
                    <small>{webMessages.applicationUnavailablePayment}</small>
                  </span>
                </label>
              </fieldset>
              <Field
                label={webMessages.applicationBillingName}
                id="application-billing-name"
                value={draft.billingName}
                onChange={(value) => update("billingName", value)}
                required
              />
              <Field
                label={webMessages.applicationBillingAddress}
                id="application-billing-address"
                value={draft.billingAddress}
                onChange={(value) => update("billingAddress", value)}
                required
              />
              <Field
                label={webMessages.applicationInvoiceRegistrationNo}
                id="application-invoice"
                value={draft.invoiceRegistrationNo}
                onChange={(value) => update("invoiceRegistrationNo", value)}
              />
            </>
          ) : null}
          {activeStep === 3 ? (
            <>
              <h1 id="application-title">
                {webMessages.applicationNotesHeading}
              </h1>
              <p className="muted-text">
                {webMessages.applicationNotesDescription}
              </p>
              <Field
                label={webMessages.applicationReferralCode}
                id="application-referral"
                value={draft.referralCode}
                onChange={(value) => {
                  referralCheckSequence.current += 1;
                  update("referralCode", value);
                  setVerifiedPartner(null);
                  setReferralInvalid(false);
                }}
                onBlur={() => void validateReferral(draft.referralCode)}
              />
              {validatingReferral ? (
                <p className="hint">
                  {webMessages.applicationReferralChecking}
                </p>
              ) : null}
              {referralInvalid ? (
                <p role="alert" className="error-message">
                  {webMessages.applicationReferralInvalid}
                </p>
              ) : null}
              {verifiedPartner ? (
                <p className="notice info">
                  {webMessages.applicationPartnerNamePrefix}
                  {verifiedPartner.name}
                </p>
              ) : null}
              {lineEnabled ? (
                <Field
                  label={webMessages.applicationLineDisplayName}
                  id="application-line-name"
                  value={draft.lineDisplayName}
                  onChange={(value) => update("lineDisplayName", value)}
                />
              ) : null}
              <label className="field-label" htmlFor="application-free-text">
                {webMessages.applicationFreeText}
              </label>
              <textarea
                id="application-free-text"
                value={draft.freeText}
                maxLength={2000}
                onChange={(event) =>
                  update("freeText", event.currentTarget.value)
                }
              />
              <p className="hint warning-text">
                {webMessages.applicationSensitiveInfoWarning}
              </p>
            </>
          ) : null}
          {activeStep === 4 ? (
            <>
              <h1 id="application-title">
                {webMessages.applicationConfirmHeading}
              </h1>
              <p className="muted-text">
                {webMessages.applicationConfirmDescription}
              </p>
              <p className="notice yellow">
                {webMessages.applicationContractNotFormed}
              </p>
              <dl className="application-summary">
                <dt>{webMessages.shopNameLabel}</dt>
                <dd>{draft.shopName}</dd>
                <dt>{webMessages.applicationContactName}</dt>
                <dd>{draft.contactName}</dd>
                <dt>{webMessages.emailLabel}</dt>
                <dd>{draft.email}</dd>
                {draft.phone.trim() ? (
                  <>
                    <dt>{webMessages.applicationPhone}</dt>
                    <dd>{draft.phone}</dd>
                  </>
                ) : null}
                <dt>{webMessages.applicationPlanLabel}</dt>
                <dd>
                  {plan?.isCustom
                    ? webMessages.applicationCustomQuoteAfterReview
                    : webMessages.applicationPlanSummaryFixed
                        .replace("{name}", plan?.name ?? "")
                        .replace(
                          "{exclPrice}",
                          plan?.priceExclTax?.toLocaleString("ja-JP") ?? "",
                        )
                        .replace(
                          "{inclPrice}",
                          plan?.priceExclTax === null ||
                            plan?.priceExclTax === undefined
                            ? ""
                            : inclYenFor(plan.priceExclTax).toLocaleString(
                                "ja-JP",
                              ),
                        )
                        .replace("{credits}", String(plan?.credits ?? ""))}
                </dd>
                <dt>{webMessages.applicationPaymentMethod}</dt>
                <dd>{webMessages.applicationBankTransfer}</dd>
                <dt>{webMessages.applicationBillingName}</dt>
                <dd>{draft.billingName}</dd>
                <dt>{webMessages.applicationBillingAddress}</dt>
                <dd>{draft.billingAddress}</dd>
                {draft.invoiceRegistrationNo.trim() ? (
                  <>
                    <dt>{webMessages.applicationInvoiceRegistrationNo}</dt>
                    <dd>{draft.invoiceRegistrationNo}</dd>
                  </>
                ) : null}
                {lineEnabled && draft.lineDisplayName.trim() ? (
                  <>
                    <dt>{webMessages.applicationLineDisplayName}</dt>
                    <dd>{draft.lineDisplayName}</dd>
                  </>
                ) : null}
                {draft.referralCode.trim() ? (
                  <>
                    <dt>{webMessages.applicationReferralCode}</dt>
                    <dd>
                      {draft.referralCode}（{verifiedPartner?.name ?? ""}）
                    </dd>
                  </>
                ) : null}
                {draft.freeText.trim() ? (
                  <>
                    <dt>{webMessages.applicationFreeText}</dt>
                    <dd>{draft.freeText}</dd>
                  </>
                ) : null}
              </dl>
              {currentVersion ? (
                <p className="hint">
                  {webMessages.applicationTermsVersion}: {policy.terms.version}{" "}
                  ／ {webMessages.applicationPrivacyVersion}:{" "}
                  {policy.privacy.version} ／{" "}
                  {webMessages.applicationDisclosureVersion}:{" "}
                  {policy.disclosure.version}
                </p>
              ) : (
                <div role="alert" className="error-message">
                  <p>{webMessages.applicationConditionsChanged}</p>
                  <button
                    className="secondary-button"
                    onClick={() => void loadPublicData()}
                    type="button"
                  >
                    {webMessages.retry}
                  </button>
                </div>
              )}
              <section className="contract-conditions">
                <h2>{webMessages.applicationContractHeading}</h2>
                <ul>
                  <li>
                    {plan?.isCustom
                      ? webMessages.applicationCustomQuoteAfterReview
                      : webMessages.applicationMonthlyPrepaid}
                  </li>
                  <li>
                    {webMessages.applicationDueDays.replace(
                      "{days}",
                      String(policy.conditions.initialDueDays),
                    )}
                  </li>
                  <li>{webMessages.applicationContractStartsOnPayment}</li>
                  <li>{webMessages.applicationAnchorPeriod}</li>
                  <li>{webMessages.applicationNoRollover}</li>
                  <li>{webMessages.applicationCancelPeriodEnd}</li>
                  <li>
                    {webMessages.applicationExtraCredit
                      .replace(
                        "{exclAmount}",
                        policy.conditions.extraCreditExclYen.toLocaleString(
                          "ja-JP",
                        ),
                      )
                      .replace(
                        "{inclAmount}",
                        inclYenFor(
                          policy.conditions.extraCreditExclYen,
                        ).toLocaleString("ja-JP"),
                      )}
                  </li>
                </ul>
              </section>
              <Consent
                checked={draft.consentBusinessUse}
                onChange={(value) => update("consentBusinessUse", value)}
                text={webMessages.applicationConsentBusiness}
                id="consent-business"
              />
              <Consent
                checked={draft.consentTerms}
                onChange={(value) => update("consentTerms", value)}
                id="consent-terms"
              >
                {webMessages.applicationConsentTerms} {legalLinks}
              </Consent>
              {draft.referralCode.trim() ? (
                <Consent
                  checked={draft.consentPartnerShare}
                  onChange={(value) => update("consentPartnerShare", value)}
                  text={`${webMessages.applicationConsentPartner}（${verifiedPartner?.name ?? ""}）`}
                  id="consent-partner"
                />
              ) : null}
              <Consent
                checked={draft.consentMarketing}
                onChange={(value) => update("consentMarketing", value)}
                text={webMessages.applicationConsentMarketing}
                id="consent-marketing"
                required={false}
              />
              <p className="hint">{webMessages.applicationReceiptReview}</p>
            </>
          ) : null}
          {fieldError ? (
            <p role="alert" className="error-message">
              {fieldError}
            </p>
          ) : null}
          {submitError ? (
            <div role="alert" className="error-message">
              <p>{submitError}</p>
              {submitError === webMessages.applicationExistingEmail ? (
                <a
                  href="/login?next=apply"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {webMessages.applicationLoginResume}
                </a>
              ) : null}
              {submitError ===
              webMessages.applicationAlreadySubmittedGuidance ? (
                <a href="/me">{webMessages.homeTitle}</a>
              ) : null}
              {conditionsChanged ? (
                <p>{webMessages.applicationReconfirmRequired}</p>
              ) : null}
              {!conditionsChanged &&
              submitError !== webMessages.applicationExistingEmail &&
              submitError !==
                webMessages.applicationAlreadySubmittedGuidance ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void submit()}
                >
                  {webMessages.retry}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="application-actions">
            {activeStep > 0 ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => movePrevious(activeStep)}
              >
                {webMessages.applicationPrevious}
              </button>
            ) : null}
            {activeStep < 4 ? (
              <button
                className="primary-button"
                type="submit"
                disabled={activeStep === 3 && validatingReferral}
              >
                {webMessages.applicationNext}
              </button>
            ) : (
              <button
                className="primary-button"
                type="submit"
                disabled={
                  submitting ||
                  !draft.consentBusinessUse ||
                  !draft.consentTerms ||
                  (Boolean(draft.referralCode.trim()) &&
                    (!draft.consentPartnerShare ||
                      verifiedPartner?.code !== draft.referralCode.trim())) ||
                  !currentVersion
                }
              >
                {submitting
                  ? webMessages.applicationSubmitting
                  : webMessages.applicationSubmit}
              </button>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}

function Field({
  label,
  id,
  value,
  onChange,
  required = false,
  type = "text",
  readOnly = false,
  autoComplete,
  onBlur,
}: {
  label: string;
  id: string;
  value: string;
  onChange(value: string): void;
  required?: boolean;
  type?: string;
  readOnly?: boolean;
  autoComplete?: string;
  onBlur?: () => void;
}) {
  return (
    <div className="application-field">
      <label className="field-label" htmlFor={id}>
        {label}
        {required ? (
          <span className="required-mark">
            {webMessages.applicationRequired}
          </span>
        ) : (
          <span className="optional-mark">
            {webMessages.applicationOptional}
          </span>
        )}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        required={required}
        readOnly={readOnly}
        autoComplete={autoComplete}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}
function Consent({
  checked,
  onChange,
  text,
  id,
  required = true,
  children,
}: {
  checked: boolean;
  onChange(value: boolean): void;
  text?: string;
  id: string;
  required?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <label className="application-consent" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        required={required}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        {children ?? text}
        {required ? (
          <span className="required-mark">
            {webMessages.applicationRequired}
          </span>
        ) : (
          <span className="optional-mark">
            {webMessages.applicationOptional}
          </span>
        )}
      </span>
    </label>
  );
}
