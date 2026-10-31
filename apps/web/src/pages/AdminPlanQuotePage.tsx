import {
  type AdminPlanQuote,
  addCalendarDays,
  type CreatePlanQuote,
  createPlanQuoteSchemaFor,
  planQuoteExpiryDays,
  planQuoteTaxFor,
  webMessages,
} from "@kobito/shared";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import type { AdminApiClient } from "../platform/admin-api-client.js";
import { AdminApiError } from "../platform/admin-api-client.js";
import {
  formatDate,
  formatSlashDate,
  tokyoDateOf,
} from "../platform/format.js";
import {
  ActionBar,
  AdminColumns,
  AdminHeading,
  Badge,
  type BadgeTone,
  Button,
  buttonClass,
  Card,
  DefinitionList,
  Field,
  Hint,
  ListItem,
  Notice,
} from "../ui/index.js";
import {
  contractStatusLabel,
  contractStatusTone,
  formatExclIncl,
  formatPaymentMethod,
} from "./admin-format.js";

const statusBadge: Record<
  AdminPlanQuote["quotes"][number]["status"],
  { label: string; tone: BadgeTone }
> = {
  awaiting: { label: webMessages.planQuoteStatusAwaiting, tone: "yellow" },
  approved: { label: webMessages.planQuoteStatusApproved, tone: "sage" },
  expired: { label: webMessages.planQuoteStatusExpired, tone: "gray" },
  superseded: { label: webMessages.planQuoteStatusSuperseded, tone: "gray" },
};

type FieldName = "priceExclTax" | "credits" | "description" | "expiresOn";
type FieldErrors = Partial<Record<FieldName, string>>;

function wholeNumber(value: string): number {
  const trimmed = value.replace(/[,\s]/g, "");
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** a04-2 プランの見積りを作る。送った版は直さず、直すときは新しい版として送り直す。 */
export function AdminPlanQuotePage({
  apiClient,
}: {
  apiClient: AdminApiClient;
}) {
  const { id = "" } = useParams();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; data: AdminPlanQuote }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [price, setPrice] = useState("");
  const [credits, setCredits] = useState("");
  const [description, setDescription] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [sendError, setSendError] = useState<
    "validation" | "conflict" | "generic" | null
  >(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);

  const applyDefaults = useCallback((data: AdminPlanQuote) => {
    setExpiresOn(addCalendarDays(data.today, planQuoteExpiryDays));
  }, []);

  // attempt は再読み込みの合図
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally retries the fetch
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    void apiClient
      .getPlanQuote(id)
      .then((data) => {
        if (!current) return;
        applyDefaults(data);
        setState({ status: "ready", data });
      })
      .catch(() => {
        if (current) setState({ status: "error" });
      });
    return () => {
      current = false;
    };
  }, [apiClient, id, attempt, applyDefaults]);

  if (state.status === "loading") {
    return (
      <output className="ui-admin__lead">
        {webMessages.adminPlanQuoteLoading}
      </output>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <AdminHeading title={webMessages.adminPlanQuoteTitle} />
        <Notice tone="warn">{webMessages.adminPlanQuoteLoadError}</Notice>
        <ActionBar>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {webMessages.retry}
          </Button>
          <Link
            className={buttonClass("ghost", { size: "sm" })}
            to={`/admin/customers/${encodeURIComponent(id)}`}
          >
            {webMessages.adminPlanQuoteBack}
          </Link>
        </ActionBar>
      </>
    );
  }

  const { data } = state;
  const latest = data.quotes[0];
  const priceNumber = wholeNumber(price);
  const taxHint =
    Number.isSafeInteger(priceNumber) && priceNumber > 0
      ? (() => {
          const tax = planQuoteTaxFor(priceNumber);
          return webMessages.adminPlanQuotePriceHint
            .replace("{incl}", tax.inclYen.toLocaleString("ja-JP"))
            .replace("{tax}", tax.taxYen.toLocaleString("ja-JP"));
        })()
      : webMessages.adminPlanQuotePriceHintEmpty;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = createPlanQuoteSchemaFor(data.today).safeParse({
      expectedVersion: data.expectedVersion,
      priceExclTax: wholeNumber(price),
      credits: wholeNumber(credits),
      description,
      expiresOn,
    });
    setSent(false);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (
          key === "priceExclTax" ||
          key === "credits" ||
          key === "description" ||
          key === "expiresOn"
        )
          errors[key] ??= issue.message;
      }
      setFieldErrors(errors);
      setSendError("validation");
      return;
    }
    setFieldErrors({});
    setSendError(null);
    inFlight.current = true;
    setSending(true);
    try {
      const value: CreatePlanQuote = parsed.data;
      await apiClient.sendPlanQuote(id, value);
      setPrice("");
      setCredits("");
      setDescription("");
      setSent(true);
      try {
        const next = await apiClient.getPlanQuote(id);
        applyDefaults(next);
        setState({ status: "ready", data: next });
      } catch {
        setSendError("generic");
      }
    } catch (caught) {
      const code = caught instanceof AdminApiError ? caught.code : null;
      setSendError(
        code === "plan_quote_conflict" ||
          code === "conflict" ||
          code === "not_found"
          ? "conflict"
          : code === "validation_error"
            ? "validation"
            : "generic",
      );
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <>
      <AdminHeading
        id="admin-plan-quote-title"
        crumb={
          <>
            <Link to="/admin/customers">{webMessages.adminNavCustomers}</Link> ›{" "}
            <Link to={`/admin/customers/${encodeURIComponent(id)}`}>
              {data.customer.shopName}
            </Link>{" "}
            ›
          </>
        }
        title={webMessages.adminPlanQuoteTitle}
        badge={
          <Badge tone={contractStatusTone(data.contract.status)}>
            {contractStatusLabel(data.contract.status)}
          </Badge>
        }
      />
      <AdminColumns>
        <Card title={webMessages.adminPlanQuoteContentHeading}>
          {sent ? <Notice live>{webMessages.adminPlanQuoteSent}</Notice> : null}
          {sendError === "conflict" ? (
            <Notice tone="warn">{webMessages.adminPlanQuoteConflict}</Notice>
          ) : null}
          {sendError === "generic" ? (
            <Notice tone="warn">{webMessages.adminPlanQuoteSendError}</Notice>
          ) : null}
          {sendError === "validation" ? (
            <Notice tone="warn">{webMessages.adminPlanQuoteValidation}</Notice>
          ) : null}
          {data.canCreate ? (
            <form noValidate onSubmit={(event) => void submit(event)}>
              <div className="ui-row2">
                <Field
                  label={webMessages.adminPlanQuotePrice}
                  required
                  hint={taxHint}
                  error={fieldErrors.priceExclTax}
                >
                  <input
                    inputMode="numeric"
                    value={price}
                    onChange={(event) => setPrice(event.currentTarget.value)}
                  />
                </Field>
                <Field
                  label={webMessages.adminPlanQuoteCredits}
                  required
                  error={fieldErrors.credits}
                >
                  <input
                    inputMode="numeric"
                    value={credits}
                    onChange={(event) => setCredits(event.currentTarget.value)}
                  />
                </Field>
              </div>
              <Field
                label={webMessages.adminPlanQuoteDescription}
                required
                error={fieldErrors.description}
              >
                <textarea
                  rows={5}
                  maxLength={2000}
                  value={description}
                  onChange={(event) =>
                    setDescription(event.currentTarget.value)
                  }
                />
              </Field>
              <Field
                label={webMessages.adminPlanQuoteExpiresOn}
                required
                hint={webMessages.adminPlanQuoteExpiresOnHint}
                error={fieldErrors.expiresOn}
              >
                <input
                  type="date"
                  value={expiresOn}
                  onChange={(event) => setExpiresOn(event.currentTarget.value)}
                />
              </Field>
              {latest ? (
                <Hint>{webMessages.adminPlanQuoteResendHint}</Hint>
              ) : null}
              <ActionBar>
                <Button size="sm" type="submit" disabled={sending}>
                  {sending
                    ? webMessages.adminPlanQuoteSending
                    : webMessages.adminPlanQuoteSend}
                </Button>
              </ActionBar>
            </form>
          ) : (
            <Notice tone="info">
              {latest?.status === "approved"
                ? webMessages.adminPlanQuoteApproved
                : webMessages.adminPlanQuoteNotAvailable}
            </Notice>
          )}
        </Card>
        <div>
          <Card title={webMessages.adminPlanQuoteApplication}>
            <DefinitionList
              items={[
                {
                  term: webMessages.adminPlanQuotePlan,
                  description: data.application.planName,
                },
                {
                  term: webMessages.adminPlanQuotePayment,
                  description: formatPaymentMethod(
                    data.application.paymentMethod,
                  ),
                },
                {
                  term: webMessages.adminPlanQuoteRequest,
                  description: data.application.freeText ?? "—",
                },
              ]}
            />
          </Card>
          <Card title={webMessages.adminPlanQuoteHistory}>
            {data.quotes.length === 0 ? (
              <Hint>{webMessages.adminPlanQuoteHistoryEmpty}</Hint>
            ) : (
              data.quotes.map((quote) => {
                const badge = statusBadge[quote.status];
                return (
                  <ListItem
                    key={quote.id}
                    title={`${webMessages.adminPlanQuoteVersion.replace("{version}", String(quote.version))}　${formatExclIncl(quote.priceExclTax)}`}
                    meta={[
                      `${quote.credits}クレジット`,
                      webMessages.adminPlanQuoteSentAt.replace(
                        "{date}",
                        formatSlashDate(tokyoDateOf(quote.sentAt)),
                      ),
                      webMessages.planQuoteExpiry.replace(
                        "{date}",
                        formatDate(quote.expiresOn),
                      ),
                      quote.approvedAt
                        ? webMessages.adminPlanQuoteApprovedAt.replace(
                            "{date}",
                            formatSlashDate(tokyoDateOf(quote.approvedAt)),
                          )
                        : null,
                    ]
                      .filter(Boolean)
                      .join("・")}
                    badge={<Badge tone={badge.tone}>{badge.label}</Badge>}
                  />
                );
              })
            )}
            <Hint>{webMessages.adminPlanQuoteHistoryNote}</Hint>
          </Card>
        </div>
      </AdminColumns>
    </>
  );
}
