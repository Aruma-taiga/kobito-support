import type { Pool, PoolClient } from "pg";
import { MailSendError } from "../integrations/mail/resend.js";
import type { MailSender } from "../integrations/mail/sender.js";
import { renderNotification } from "../modules/notifications/templates.js";

interface NotificationRow {
  id: string;
  kind: string;
  customer_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  dedupe_key: string;
}

interface NotificationDataRow {
  email: string | null;
  contact_name: string | null;
  service_name: unknown;
  contact_email: unknown;
  bank_account: unknown;
  invoice_no: string | null;
  due_on: string | null;
  total_incl_tax: number | null;
  payment_method: string | null;
  credits: number | null;
}

export interface NotificationDispatchOptions {
  pool: Pool;
  sender?: MailSender;
  limit?: number;
  notificationIds?: string[];
}

export interface NotificationDispatchResult {
  sent: number;
  failed: number;
  skipped: number;
}

const dispatchableKinds = [
  "NT-01",
  "S-03",
  "NT-02",
  "NT-02b",
  "NT-03",
  "NT-04",
  "NT-05",
  "NT-06",
  "NT-07",
  "NT-08",
  "NT-09",
];

export async function runNotificationDispatch(
  now: Date,
  options: NotificationDispatchOptions,
): Promise<NotificationDispatchResult> {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new RangeError("Notification limit must be between 1 and 1000");
  if (!options.sender) {
    const pending = await options.pool.query<{ count: number }>(
      `select count(*)::int as count from notifications
        where channel='email' and kind=any($2::text[])
          and sent_at is null and attempts < 3 and scheduled_at <= $1
          and ($3::uuid[] is null or id = any($3::uuid[]))`,
      [now, dispatchableKinds, options.notificationIds ?? null],
    );
    return { sent: 0, failed: 0, skipped: pending.rows[0]?.count ?? 0 };
  }

  const client = await options.pool.connect();
  const result: NotificationDispatchResult = { sent: 0, failed: 0, skipped: 0 };
  try {
    await client.query("begin");
    const rows = await client.query<NotificationRow>(
      `select id,kind,customer_id,payload,attempts,dedupe_key from notifications
        where channel='email' and kind=any($4::text[])
          and sent_at is null and attempts < 3 and scheduled_at <= $1
          and ($3::uuid[] is null or id = any($3::uuid[]))
        order by scheduled_at,id limit $2 for update skip locked`,
      [now, limit, options.notificationIds ?? null, dispatchableKinds],
    );
    for (const notification of rows.rows) {
      try {
        const invoiceStatus =
          notification.kind === "NT-05"
            ? await lockAndReadInvoiceStatus(client, notification)
            : null;
        if (
          notification.kind === "NT-05" &&
          !["failed", "issued"].includes(invoiceStatus ?? "")
        ) {
          await client.query(
            "update notifications set attempts=3,last_error='invoice_not_payable' where id=$1",
            [notification.id],
          );
          result.skipped += 1;
          continue;
        }
        if (notification.kind === "NT-09") {
          const contractId = notification.payload.contractId;
          const contract =
            typeof contractId === "string"
              ? await client.query<{ status: string }>(
                  "select status from contracts where id=$1",
                  [contractId],
                )
              : null;
          if (contract?.rows[0]?.status !== "ended") {
            await client.query(
              "update notifications set scheduled_at=$2 + interval '5 minutes' where id=$1",
              [notification.id, now],
            );
            result.skipped += 1;
            continue;
          }
        }
        const data = await loadNotificationData(client, notification);
        const recipient =
          notification.kind === "S-03"
            ? settingString(data.contact_email)
            : data.email;
        if (!recipient) throw new Error("recipient_unavailable");
        const serviceName = settingString(data.service_name);
        const contactEmail = settingString(data.contact_email);
        if (!serviceName || !contactEmail)
          throw new Error("settings_unavailable");
        const details = bankDetails(data.bank_account);
        if (
          ["NT-02", "NT-03"].includes(notification.kind) &&
          data.payment_method === "bank_transfer" &&
          !details
        )
          throw new Error("settings_unavailable");
        const template = renderNotification({
          kind: notification.kind,
          serviceName,
          contactEmail,
          ...(data.contact_name ? { customerName: data.contact_name } : {}),
          ...(data.invoice_no ? { invoiceNo: data.invoice_no } : {}),
          ...(data.due_on ? { dueOn: data.due_on } : {}),
          ...(typeof notification.payload.endsOn === "string"
            ? { dueOn: notification.payload.endsOn }
            : {}),
          ...(data.total_incl_tax === null
            ? {}
            : { amountInclTax: data.total_incl_tax }),
          ...(data.payment_method
            ? { paymentMethod: data.payment_method }
            : {}),
          ...("status" in notification.payload &&
          typeof notification.payload.status === "string"
            ? { status: notification.payload.status }
            : {}),
          ...(data.credits === null ? {} : { credits: data.credits }),
          ...(typeof notification.payload.extraCredits === "number"
            ? { extraCredits: notification.payload.extraCredits }
            : {}),
          ...(["NT-02", "NT-03"].includes(notification.kind) && details
            ? { bankDetails: details }
            : {}),
        });
        await options.sender.send({
          to: recipient,
          ...template,
          idempotencyKey: notification.dedupe_key,
        });
        await client.query(
          "update notifications set sent_at=$2,last_error=null where id=$1",
          [notification.id, now],
        );
        result.sent += 1;
      } catch (error) {
        const reason =
          error instanceof Error &&
          ["recipient_unavailable", "settings_unavailable"].includes(
            error.message,
          )
            ? error.message
            : error instanceof MailSendError
              ? error.reason
              : "send_failed";
        await client.query(
          "update notifications set attempts=attempts+1,last_error=$2 where id=$1",
          [notification.id, reason],
        );
        result.failed += 1;
      }
    }
    await client.query("commit");
    return result;
  } catch {
    await client.query("rollback");
    throw new Error("Notification dispatch failed");
  } finally {
    client.release();
  }
}

async function loadNotificationData(client: PoolClient, row: NotificationRow) {
  const result = await client.query<NotificationDataRow>(
    `select c.email,c.contact_name,
            (select value from settings where key='service_name') as service_name,
            (select value from settings where key='contact_email') as contact_email,
            (select value from settings where key='bank_account') as bank_account,
            i.invoice_no,i.due_on::text as due_on,
            i.total_incl_tax,i.payment_method,p.credits
       from (select 1) seed
       left join customers c on c.id=$1
       left join invoices i on i.id=nullif($2,'')::uuid
       left join billing_periods p on p.id=nullif($3,'')::uuid`,
    [
      row.customer_id,
      typeof row.payload.invoiceId === "string" ? row.payload.invoiceId : null,
      typeof row.payload.periodId === "string" ? row.payload.periodId : null,
    ],
  );
  const data = result.rows[0];
  if (!data) throw new Error("settings_unavailable");
  return data;
}

async function lockAndReadInvoiceStatus(
  client: PoolClient,
  row: NotificationRow,
): Promise<string | null> {
  const invoiceId = row.payload.invoiceId;
  if (typeof invoiceId !== "string") return null;
  const result = await client.query<{ status: string }>(
    "select status from invoices where id=$1 for update",
    [invoiceId],
  );
  return result.rows[0]?.status ?? null;
}

function settingString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  return null;
}

function bankDetails(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const bank = value as Record<string, unknown>;
  const fields = [
    bank.bank_name,
    bank.branch_name,
    bank.account_type,
    bank.account_number,
    bank.account_holder,
  ].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return fields.length === 5 ? fields.join(" / ") : undefined;
}
