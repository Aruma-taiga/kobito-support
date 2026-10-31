export interface HostedSessionRequest {
  externalOrderNum: string;
  amountYen: number;
  returnUrl: string;
}

export interface HostedSession {
  sessionId: string;
  redirectUrl: string;
}

export interface KomojuClient {
  createHostedSession(request: HostedSessionRequest): Promise<HostedSession>;
}

export class KomojuClientError extends Error {
  constructor() {
    super("KOMOJU request failed");
    this.name = "KomojuClientError";
  }
}

type Fetcher = typeof fetch;

/**
 * Implements the documented KOMOJU Hosted Page Sessions API. Live merchant
 * behavior has not been verified; validate the account configuration before
 * enabling payment links in production.
 */
export class HttpKomojuClient implements KomojuClient {
  constructor(
    private readonly secretKey: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = 8_000,
  ) {}

  async createHostedSession(
    request: HostedSessionRequest,
  ): Promise<HostedSession> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(
        "https://komoju.com/api/v1/sessions",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString("base64")}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            mode: "payment",
            amount: request.amountYen,
            currency: "JPY",
            return_url: request.returnUrl,
            payment_types: ["credit_card"],
            payment_data: { external_order_num: request.externalOrderNum },
            default_locale: "ja",
          }),
          signal: controller.signal,
          redirect: "error",
          cache: "no-store",
        },
      );
      if (!response.ok) throw new KomojuClientError();
      const payload: unknown = await response.json();
      if (typeof payload !== "object" || payload === null)
        throw new KomojuClientError();
      const record = payload as Record<string, unknown>;
      if (
        typeof record.id !== "string" ||
        record.id.length === 0 ||
        typeof record.session_url !== "string"
      )
        throw new KomojuClientError();
      const redirect = new URL(record.session_url);
      if (
        redirect.protocol !== "https:" ||
        !(
          redirect.hostname === "komoju.com" ||
          redirect.hostname.endsWith(".komoju.com")
        )
      )
        throw new KomojuClientError();
      return { sessionId: record.id, redirectUrl: redirect.toString() };
    } catch {
      throw new KomojuClientError();
    } finally {
      clearTimeout(timeout);
    }
  }
}
