import type { MailMessage, MailSender } from "./sender.js";

export class MailSendError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly reason: "mail_http_4xx" | "mail_http_5xx" | "mail_network_error",
  ) {
    super(reason);
    this.name = "MailSendError";
  }
}

export class ResendMailSender implements MailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const headers: Record<string, string> = {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      };
      if (message.idempotencyKey)
        headers["Idempotency-Key"] = message.idempotencyKey;
      const response = await this.fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers,
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        const permanent = response.status >= 400 && response.status < 500;
        throw new MailSendError(
          !permanent,
          permanent ? "mail_http_4xx" : "mail_http_5xx",
        );
      }
    } catch (error) {
      if (error instanceof MailSendError) throw error;
      throw new MailSendError(true, "mail_network_error");
    } finally {
      clearTimeout(timeout);
    }
  }
}
