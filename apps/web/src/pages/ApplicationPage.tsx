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
import {
  Button,
  Card,
  CheckOption,
  DefinitionList,
  Field,
  Notice,
  RadioOption,
  Steps,
} from "../ui/index.js";

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
      {webMessages.applicationPlanChoiceExclPrice.replace(
        "{price}",
        priceExclTax.toLocaleString("ja-JP"),
      )}
      <small>
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
  const { lineEnabled, contactEmail } = useContact();
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

  const stepsView = (
    <Steps
      labels={stepNames}
      current={activeStep}
      label={webMessages.applicationProgressLabel}
    />
  );
  const pageShell = (children: React.ReactNode) => (
    <main className="ui-page">{children}</main>
  );

  if (loading)
    return pageShell(
      <output className="status-message">
        {webMessages.applicationLoading}
      </output>,
    );
  if (loadError)
    return pageShell(
      <Card>
        <Notice tone="warn">{webMessages.applicationLoadError}</Notice>
        <Button
          variant="ghost"
          onClick={() => void loadPublicData()}
          type="button"
        >
          {webMessages.retry}
        </Button>
      </Card>,
    );
  if (session.status === "loading" && !authClient.currentUser())
    return pageShell(
      <output className="status-message">{webMessages.sessionLoading}</output>,
    );
  if (activeStep < 0) return null;
  if (activeStep === 5)
    return receiptRef.current
      ? pageShell(
          <>
            <Steps
              labels={stepNames}
              current={stepNames.length}
              label={webMessages.applicationProgressLabel}
            />
            <div className="ui-done-mark" aria-hidden="true">
              ✓
            </div>
            <h1 className="ui-title ui-center">
              {webMessages.applicationReceiptTitle}
            </h1>
            <Notice
              tone="yellow"
              title={webMessages.applicationContractNotFormed}
            >
              {webMessages.applicationReceiptDescription}
            </Notice>
            <Card title={webMessages.applicationReceiptFlowTitle}>
              <ol className="ui-timeline">
                <li className="ui-timeline__done">
                  {webMessages.applicationFlowApplied}
                  <span className="ui-timeline__note">
                    {webMessages.applicationFlowAppliedNote}
                  </span>
                </li>
                <li className="ui-timeline__now" aria-current="step">
                  {webMessages.applicationFlowReview}
                </li>
                <li>
                  {webMessages.applicationFlowNotice}
                  <span className="ui-timeline__note">
                    {webMessages.applicationFlowNoticeNote}
                  </span>
                </li>
                <li>
                  {webMessages.applicationFlowPayment}
                  <span className="ui-timeline__note">
                    {webMessages.applicationFlowPaymentNote.replace(
                      "{days}",
                      String(policy?.conditions.initialDueDays ?? 7),
                    )}
                  </span>
                </li>
                <li>
                  {webMessages.applicationFlowContract}
                  <span className="ui-timeline__note">
                    {webMessages.applicationFlowContractNote}
                  </span>
                </li>
              </ol>
            </Card>
            <Button fullWidth variant="ghost" href="/me">
              {webMessages.applicationMypageLink}
            </Button>
            {contactEmail ? (
              <p className="ui-hint ui-center" style={{ marginTop: 14 }}>
                {webMessages.applicationContactGuidanceBefore}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                {webMessages.applicationContactGuidanceAfter}
              </p>
            ) : null}
          </>,
        )
      : null;
  if (!policy)
    return pageShell(
      <Card>
        <h1 className="ui-title">{webMessages.applicationUnavailableTitle}</h1>
        <p className="ui-lead">
          {webMessages.applicationUnavailableDescription}
        </p>
        <Button
          variant="ghost"
          onClick={() => void loadPublicData()}
          type="button"
        >
          {webMessages.retry}
        </Button>
      </Card>,
    );

  const currentVersion =
    plans?.displayVersion === policy.displayVersion
      ? plans.displayVersion
      : null;
  const legalLinks = (
    <>
      <a href={policy.terms.url} target="_blank" rel="noopener noreferrer">
        {webMessages.applicationTermsLink}
      </a>
      {" ・ "}
      <a href={policy.privacy.url} target="_blank" rel="noopener noreferrer">
        {webMessages.applicationPrivacyLink}
      </a>
      {" ・ "}
      <a href={policy.disclosure.url} target="_blank" rel="noopener noreferrer">
        {webMessages.applicationDisclosureLink}
      </a>
    </>
  );
  const exclPrice = plan?.priceExclTax ?? null;
  const inclPrice = exclPrice === null ? null : inclYenFor(exclPrice);
  const yen = (value: number) => `${value.toLocaleString("ja-JP")}円`;
  const summaryItems: Array<{ term: string; description: React.ReactNode }> = [
    { term: webMessages.shopNameLabel, description: draft.shopName },
    {
      term: webMessages.applicationContactName,
      description: draft.contactName,
    },
    { term: webMessages.emailLabel, description: draft.email },
  ];
  if (draft.phone.trim())
    summaryItems.push({
      term: webMessages.applicationPhone,
      description: draft.phone,
    });
  summaryItems.push({
    term: webMessages.applicationPlanLabel,
    description: plan?.isCustom
      ? webMessages.applicationCustomQuoteAfterReview
      : webMessages.applicationPlanSummaryFixed
          .replace("{name}", plan?.name ?? "")
          .replace("{exclPrice}", exclPrice?.toLocaleString("ja-JP") ?? "")
          .replace("{inclPrice}", inclPrice?.toLocaleString("ja-JP") ?? "")
          .replace("{credits}", String(plan?.credits ?? "")),
  });
  if (exclPrice !== null && inclPrice !== null)
    summaryItems.push(
      {
        term: webMessages.applicationTaxExclLabel,
        description: yen(exclPrice),
      },
      {
        term: webMessages.applicationTaxLabel,
        description: yen(inclPrice - exclPrice),
      },
      {
        term: webMessages.applicationTaxInclLabel,
        description: yen(inclPrice),
      },
    );
  summaryItems.push(
    {
      term: webMessages.applicationPaymentMethod,
      description: webMessages.applicationBankTransfer,
    },
    {
      term: webMessages.applicationBillingName,
      description: draft.billingName,
    },
    {
      term: webMessages.applicationBillingAddress,
      description: draft.billingAddress,
    },
  );
  if (draft.invoiceRegistrationNo.trim())
    summaryItems.push({
      term: webMessages.applicationInvoiceRegistrationNo,
      description: draft.invoiceRegistrationNo,
    });
  if (lineEnabled && draft.lineDisplayName.trim())
    summaryItems.push({
      term: webMessages.applicationLineDisplayName,
      description: draft.lineDisplayName,
    });
  if (draft.referralCode.trim())
    summaryItems.push({
      term: webMessages.applicationReferralCode,
      description: `${draft.referralCode}（${verifiedPartner?.name ?? ""}）`,
    });
  if (draft.freeText.trim())
    summaryItems.push({
      term: webMessages.applicationFreeText,
      description: draft.freeText,
    });

  const nextLabels = [
    webMessages.applicationNextToPlan,
    webMessages.applicationNextToPayment,
    webMessages.applicationNextToNotes,
    webMessages.applicationNextToConfirm,
  ];
  const titles = [
    webMessages.applicationShopTitle,
    webMessages.applicationPlanHeading,
    webMessages.applicationPaymentHeading,
    webMessages.applicationNotesHeading,
    webMessages.applicationConfirmHeading,
  ];
  const leads = [
    webMessages.applicationDescription,
    webMessages.applicationPlanDescription,
    webMessages.applicationPaymentDescription,
    webMessages.applicationNotesDescription,
    webMessages.applicationConfirmDescription,
  ];

  return (
    <main className="ui-page">
      <section aria-labelledby="application-title">
        {policy.mode === "preview" ? (
          <Notice tone="yellow">{webMessages.applicationPreviewWarning}</Notice>
        ) : null}
        {stepsView}
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
          <h1 className="ui-title" id="application-title">
            {titles[activeStep]}
          </h1>
          <p className="ui-lead">{leads[activeStep]}</p>
          {activeStep === 0 ? (
            <>
              <TextField
                label={webMessages.applicationShopNameLabel}
                id="application-shop"
                value={draft.shopName}
                onChange={(value) => update("shopName", value)}
                required
              />
              <TextField
                label={webMessages.applicationContactName}
                id="application-contact"
                value={draft.contactName}
                onChange={(value) => update("contactName", value)}
                required
              />
              <TextField
                label={webMessages.emailLabel}
                id="application-email"
                type="email"
                autoComplete="email"
                value={draft.email}
                onChange={(value) => update("email", value)}
                required
                readOnly={isAuthenticated}
                hint={
                  isAuthenticated
                    ? webMessages.applicationSignedInEmail
                    : webMessages.applicationEmailHint
                }
              />
              <TextField
                label={webMessages.applicationPhone}
                id="application-phone"
                type="tel"
                value={draft.phone}
                onChange={(value) => update("phone", value)}
              />
              {!isAuthenticated ? (
                <TextField
                  label={webMessages.passwordLabel}
                  id="application-password"
                  type="password"
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(value) => update("password", value)}
                  required
                  hint={`${webMessages.applicationPasswordRuleHint}${webMessages.applicationPasswordHint}`}
                />
              ) : null}
            </>
          ) : null}
          {activeStep === 1 ? (
            <>
              <div className="ui-radio-list">
                {(plans?.plans ?? []).map((item) => (
                  <RadioOption
                    key={item.id}
                    name="plan"
                    value={item.code}
                    checked={draft.planCode === item.code}
                    onChange={() => update("planCode", item.code)}
                    title={item.name}
                    price={
                      item.isCustom
                        ? webMessages.applicationCustomPrice
                        : formatMonthlyPrice(item.priceExclTax)
                    }
                    description={
                      item.isCustom
                        ? webMessages.applicationCustomDescription
                        : `毎月${item.credits}クレジット`
                    }
                  />
                ))}
              </div>
              <p className="ui-hint" style={{ margin: "10px 0 20px" }}>
                {webMessages.applicationPlanPriceHint}
              </p>
            </>
          ) : null}
          {activeStep === 2 ? (
            <>
              <fieldset className="ui-radio-list">
                <legend className="visually-hidden">
                  {webMessages.applicationPaymentMethod}
                </legend>
                <RadioOption
                  name="payment"
                  checked={draft.paymentMethod === "card"}
                  disabled={!config?.cardPaymentEnabled}
                  readOnly={!config?.cardPaymentEnabled}
                  onChange={() => update("paymentMethod", "card")}
                  title={webMessages.applicationCardPayment}
                  description={
                    config?.cardPaymentEnabled
                      ? webMessages.applicationCardDescription
                      : `${webMessages.applicationCardDescription}（${webMessages.applicationUnavailablePayment}）`
                  }
                />
                <RadioOption
                  name="payment"
                  checked={draft.paymentMethod === "bank_transfer"}
                  onChange={() => update("paymentMethod", "bank_transfer")}
                  title={webMessages.applicationBankTransfer}
                  description={webMessages.applicationBankTransferDescription}
                />
              </fieldset>
              <div style={{ marginTop: 18 }}>
                <TextField
                  label={webMessages.applicationBillingName}
                  id="application-billing-name"
                  value={draft.billingName}
                  onChange={(value) => update("billingName", value)}
                  required
                />
                <TextField
                  label={webMessages.applicationBillingAddress}
                  id="application-billing-address"
                  value={draft.billingAddress}
                  onChange={(value) => update("billingAddress", value)}
                  required
                />
                <TextField
                  label={webMessages.applicationInvoiceRegistrationNo}
                  id="application-invoice"
                  value={draft.invoiceRegistrationNo}
                  onChange={(value) => update("invoiceRegistrationNo", value)}
                  placeholder="T0000000000000"
                />
              </div>
            </>
          ) : null}
          {activeStep === 3 ? (
            <>
              <TextField
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
                hint={
                  validatingReferral
                    ? webMessages.applicationReferralChecking
                    : undefined
                }
              />
              {referralInvalid ? (
                <Notice tone="warn">
                  {webMessages.applicationReferralInvalid}
                </Notice>
              ) : null}
              {verifiedPartner ? (
                <Notice>
                  {webMessages.applicationPartnerNamePrefix}
                  {verifiedPartner.name}
                </Notice>
              ) : null}
              {lineEnabled ? (
                <TextField
                  label={webMessages.applicationLineDisplayName}
                  id="application-line-name"
                  value={draft.lineDisplayName}
                  onChange={(value) => update("lineDisplayName", value)}
                />
              ) : null}
              <Field
                label={webMessages.applicationFreeText}
                optional
                hint={
                  <span className="ui-hint--warn">
                    {webMessages.applicationSensitiveInfoWarning}
                  </span>
                }
              >
                <textarea
                  id="application-free-text"
                  value={draft.freeText}
                  maxLength={2000}
                  onChange={(event) =>
                    update("freeText", event.currentTarget.value)
                  }
                />
              </Field>
            </>
          ) : null}
          {activeStep === 4 ? (
            <>
              <Notice
                tone="yellow"
                title={webMessages.applicationContractNotFormed}
              >
                {webMessages.applicationReceiptReview}
              </Notice>
              <Card
                title={webMessages.applicationSummaryHeading}
                action={
                  <button
                    type="button"
                    className="ui-linkbtn"
                    onClick={() => navigate(stepPaths[0])}
                  >
                    {webMessages.applicationEdit}
                  </button>
                }
              >
                <DefinitionList items={summaryItems} />
              </Card>
              {currentVersion ? (
                <p className="ui-hint" style={{ marginBottom: 14 }}>
                  {webMessages.applicationTermsVersion}: {policy.terms.version}{" "}
                  ／ {webMessages.applicationPrivacyVersion}:{" "}
                  {policy.privacy.version} ／{" "}
                  {webMessages.applicationDisclosureVersion}:{" "}
                  {policy.disclosure.version}
                </p>
              ) : (
                <Notice tone="warn">
                  <p>{webMessages.applicationConditionsChanged}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadPublicData()}
                    type="button"
                  >
                    {webMessages.retry}
                  </Button>
                </Notice>
              )}
              <Card
                title={webMessages.applicationContractHeading}
                className="ui-card--accent"
              >
                <div className="ui-clause">
                  {plan?.isCustom
                    ? webMessages.applicationCustomQuoteAfterReview
                    : webMessages.applicationMonthlyPrepaid}
                </div>
                <div className="ui-clause">
                  {webMessages.applicationDueDays.replace(
                    "{days}",
                    String(policy.conditions.initialDueDays),
                  )}
                </div>
                <div className="ui-clause">
                  {webMessages.applicationContractStartsOnPayment}
                </div>
                <div className="ui-clause">
                  {webMessages.applicationAnchorPeriod}
                </div>
                <div className="ui-clause">
                  {webMessages.applicationNoRollover}
                </div>
                <div className="ui-clause">
                  {webMessages.applicationCancelPeriodEnd}
                </div>
                <div className="ui-clause">
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
                </div>
              </Card>
              <Card title={webMessages.applicationConsentHeading}>
                <CheckOption
                  id="consent-business"
                  required
                  checked={draft.consentBusinessUse}
                  onChange={(event) =>
                    update("consentBusinessUse", event.currentTarget.checked)
                  }
                >
                  {webMessages.applicationConsentBusiness}
                </CheckOption>
                <CheckOption
                  id="consent-terms"
                  required
                  checked={draft.consentTerms}
                  onChange={(event) =>
                    update("consentTerms", event.currentTarget.checked)
                  }
                >
                  {webMessages.applicationConsentTerms} {legalLinks}
                </CheckOption>
                {draft.referralCode.trim() ? (
                  <CheckOption
                    id="consent-partner"
                    required
                    checked={draft.consentPartnerShare}
                    onChange={(event) =>
                      update("consentPartnerShare", event.currentTarget.checked)
                    }
                  >
                    {webMessages.applicationConsentPartner}
                    {`（${verifiedPartner?.name ?? ""}）`}
                  </CheckOption>
                ) : null}
                <CheckOption
                  id="consent-marketing"
                  optional
                  checked={draft.consentMarketing}
                  onChange={(event) =>
                    update("consentMarketing", event.currentTarget.checked)
                  }
                >
                  {webMessages.applicationConsentMarketing}
                </CheckOption>
              </Card>
            </>
          ) : null}
          {fieldError ? <Notice tone="warn">{fieldError}</Notice> : null}
          {submitError ? (
            <Notice tone="warn">
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
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => void submit()}
                >
                  {webMessages.retry}
                </Button>
              ) : null}
            </Notice>
          ) : null}
          <div className="ui-actions">
            {activeStep < 4 ? (
              <Button
                fullWidth
                type="submit"
                disabled={activeStep === 3 && validatingReferral}
              >
                {nextLabels[activeStep]}
              </Button>
            ) : (
              <Button
                fullWidth
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
              </Button>
            )}
            {activeStep > 0 ? (
              <Button
                fullWidth
                variant="ghost"
                type="button"
                onClick={() => movePrevious(activeStep)}
              >
                {webMessages.applicationPrevious}
              </Button>
            ) : null}
          </div>
        </form>
      </section>
    </main>
  );
}

function TextField({
  label,
  id,
  value,
  onChange,
  required = false,
  type = "text",
  readOnly = false,
  autoComplete,
  onBlur,
  hint,
  placeholder,
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
  hint?: React.ReactNode;
  placeholder?: string;
}) {
  return (
    <Field label={label} required={required} optional={!required} hint={hint}>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        required={required}
        readOnly={readOnly}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </Field>
  );
}
