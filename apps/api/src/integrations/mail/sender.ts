export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

export class FakeMailSender implements MailSender {
  readonly messages: MailMessage[] = [];
  failure: Error | undefined;

  async send(message: MailMessage): Promise<void> {
    if (this.failure) throw this.failure;
    this.messages.push({ ...message });
  }
}

/** Development sink. It deliberately never prints message contents or addresses. */
export class LogMailSender implements MailSender {
  constructor(private readonly log: (entry: string) => void = console.info) {}

  async send(message: MailMessage): Promise<void> {
    const kind = message.subject.includes("お申込み")
      ? "NT-01"
      : message.subject.includes("新しい申込み")
        ? "S-03"
        : message.subject.includes("月額分の請求書")
          ? "NT-03"
          : message.subject.includes("請求書")
            ? "NT-02"
            : message.subject.includes("ご入金")
              ? "NT-02b"
              : message.subject.includes("カード")
                ? "NT-05"
                : message.subject.includes("クレジット")
                  ? "NT-04"
                  : message.subject.includes("お見積り")
                    ? "NT-06"
                    : message.subject.includes("ご依頼")
                      ? "NT-07"
                      : "email";
    const at = message.to.lastIndexOf("@");
    const maskedTo =
      at > 1 ? `${message.to[0]}***${message.to.slice(at)}` : "***";
    this.log(
      JSON.stringify({
        kind,
        subject: message.subject,
        to: maskedTo,
      }),
    );
  }
}
