import { type CustomerPlanQuote, webMessages } from "@kobito/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SignOutAction } from "../auth/SignOutAction.js";
import {
  ApiClientError,
  type ReturnTypeApiClient,
} from "../platform/api-client.js";
import { contactMailHref, useContact } from "../platform/contact.js";
import { formatDate, tokyoDateOf } from "../platform/format.js";
import {
  Badge,
  type BadgeTone,
  Block,
  Button,
  Card,
  Hint,
  Lead,
  Notice,
  Page,
  StatTiles,
  Steps,
  Title,
} from "../ui/index.js";

const statusBadge: Record<
  CustomerPlanQuote["status"],
  { label: string; tone: BadgeTone }
> = {
  awaiting: { label: webMessages.planQuoteStatusAwaiting, tone: "yellow" },
  approved: { label: webMessages.planQuoteStatusApproved, tone: "sage" },
  expired: { label: webMessages.planQuoteStatusExpired, tone: "gray" },
  superseded: { label: webMessages.planQuoteStatusSuperseded, tone: "gray" },
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; quote: CustomerPlanQuote };

/** c12 プランのお見積り（個別見積り）。了承すると初月の請求書が出て、お支払いの画面へ進む。 */
export function CustomerPlanQuotePage({
  apiClient,
}: {
  apiClient: ReturnTypeApiClient;
}) {
  const navigate = useNavigate();
  const { contactEmail } = useContact();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<
    "generic" | "changed" | "expired" | null
  >(null);
  const inFlight = useRef(false);

  // attempt は再読み込みの合図
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally retries the fetch
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    void apiClient
      .getPlanQuote()
      .then((quote) => {
        if (current) setState({ status: "ready", quote });
      })
      .catch(() => {
        if (current) setState({ status: "error" });
      });
    return () => {
      current = false;
    };
  }, [apiClient, attempt]);

  const reload = useCallback(() => {
    setProblem(null);
    setAttempt((value) => value + 1);
  }, []);

  async function approve(quote: CustomerPlanQuote) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setProblem(null);
    try {
      await apiClient.approvePlanQuote(quote.id);
      navigate("/me/waiting");
    } catch (caught) {
      const code = caught instanceof ApiClientError ? caught.code : null;
      setProblem(
        code === "plan_quote_expired"
          ? "expired"
          : code === "plan_quote_conflict" || code === "not_found"
            ? "changed"
            : "generic",
      );
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <Page>
        <output className="ui-lead">{webMessages.planQuoteLoading}</output>
      </Page>
    );
  }
  if (state.status === "error") {
    return (
      <Page>
        <Notice tone="warn">{webMessages.planQuoteLoadError}</Notice>
        <Button variant="ghost" onClick={reload}>
          {webMessages.retry}
        </Button>
        <SignOutAction />
      </Page>
    );
  }

  const { quote } = state;
  const badge = statusBadge[quote.status];
  const items = quote.description
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const mailHref = contactMailHref(
    contactEmail,
    webMessages.planQuoteConsultSubject,
  );
  const problemText =
    problem === "expired"
      ? webMessages.planQuoteExpiredError
      : problem === "changed"
        ? webMessages.planQuoteChanged
        : problem === "generic"
          ? webMessages.planQuoteApproveError
          : null;

  return (
    <Page>
      <Steps
        current={2}
        label={webMessages.planQuoteStepsLabel}
        labels={[...webMessages.planQuoteSteps]}
      />
      <Title id="plan-quote-title">{webMessages.planQuoteTitle}</Title>
      {quote.status === "awaiting" ? (
        <Lead>{webMessages.planQuoteLead}</Lead>
      ) : null}
      {quote.status === "expired" ? (
        <Notice tone="warn">{webMessages.planQuoteExpiredNotice}</Notice>
      ) : null}
      {problemText ? (
        <Notice tone="warn">
          {problemText}
          {problem === "changed" ? (
            <>
              {" "}
              <Button variant="ghost" size="sm" onClick={reload}>
                {webMessages.planQuoteReload}
              </Button>
            </>
          ) : null}
        </Notice>
      ) : null}
      <Card
        className="ui-card--accent"
        title={webMessages.planQuoteCardTitle}
        action={<Badge tone={badge.tone}>{badge.label}</Badge>}
      >
        <StatTiles
          items={[
            {
              key: "price",
              label: webMessages.planQuoteMonthlyExcl,
              value: (
                <>
                  {quote.priceExclTax.toLocaleString("ja-JP")}
                  <span className="ui-tile__unit">円</span>
                </>
              ),
              note: webMessages.planQuoteTaxIncl
                .replace("{incl}", quote.priceInclTax.toLocaleString("ja-JP"))
                .replace("{tax}", quote.taxAmount.toLocaleString("ja-JP")),
            },
            {
              key: "credits",
              label: webMessages.planQuoteCredits,
              value: quote.credits,
              tone: "gray",
            },
          ]}
        />
        <Block title={webMessages.planQuoteContent}>
          <ol>
            {items.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ol>
        </Block>
        <Block title={webMessages.planQuoteTerms}>
          <p>{webMessages.planQuoteTermsBody}</p>
        </Block>
        <Hint>
          {webMessages.planQuoteExpiry.replace(
            "{date}",
            formatDate(quote.expiresOn),
          )}
          <br />
          {webMessages.planQuoteSentOn.replace(
            "{date}",
            formatDate(tokyoDateOf(quote.sentAt)),
          )}
        </Hint>
      </Card>
      <div className="ui-actions">
        {quote.canApprove ? (
          <Button
            fullWidth
            disabled={submitting}
            onClick={() => void approve(quote)}
          >
            {submitting
              ? webMessages.planQuoteApproving
              : webMessages.planQuoteApprove}
          </Button>
        ) : null}
        {mailHref ? (
          <Button fullWidth variant="ghost" href={mailHref}>
            {webMessages.planQuoteConsult}
          </Button>
        ) : null}
      </div>
      {quote.status === "awaiting" ? (
        <Hint align="center">{webMessages.planQuoteExpiredFooter}</Hint>
      ) : null}
      <SignOutAction />
    </Page>
  );
}
