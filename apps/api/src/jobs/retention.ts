import { retentionDueDate } from "@kobito/shared";
import type { Pool } from "pg";

export interface RetentionResult {
  customers: number;
  serviceRequests: number;
  estimates: number;
  applications: number;
  pendingNotifications: number;
  authUserIds: string[];
  dryRun: boolean;
  failed: number;
}

interface CustomerCandidate {
  id: string;
  deletion_due_on: string;
  anonymized_at: string | null;
}

/** Retain financial/agreement rows and anonymize personal fields atomically per customer. */
export async function runRetentionPurge(
  today: string,
  pool: Pool,
  options: { contractIds?: string[]; dryRun?: boolean } = {},
): Promise<RetentionResult> {
  // Validate even when there are no candidates.
  retentionDueDate("ended", today);
  const candidates = await pool.query<CustomerCandidate>(
    `select cu.id, cu.deletion_due_on::text, cu.anonymized_at::text
       from customers cu
      where cu.deletion_due_on <= $1::date and cu.anonymized_at is null
        and ($2::uuid[] is null or exists (
          select 1 from contracts scoped where scoped.customer_id=cu.id and scoped.id=any($2::uuid[])))
      order by cu.id`,
    [today, options.contractIds ?? null],
  );
  const result: RetentionResult = {
    customers: 0,
    serviceRequests: 0,
    estimates: 0,
    applications: 0,
    pendingNotifications: 0,
    authUserIds: [],
    dryRun: options.dryRun ?? false,
    failed: 0,
  };

  for (const candidate of candidates.rows) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const contracts = await client.query<{ id: string; status: string }>(
        `select id,status from contracts where customer_id=$1 order by id for update`,
        [candidate.id],
      );
      if (
        contracts.rows.length === 0 ||
        contracts.rows.some(
          (contract) =>
            !["ended", "lapsed", "declined"].includes(contract.status),
        )
      ) {
        await client.query("rollback");
        continue;
      }
      const locked = await client.query<CustomerCandidate>(
        `select id,deletion_due_on::text,anonymized_at::text from customers
          where id=$1 for update`,
        [candidate.id],
      );
      const customer = locked.rows[0];
      if (
        !customer ||
        customer.anonymized_at ||
        customer.deletion_due_on > today
      ) {
        await client.query("rollback");
        continue;
      }
      const users = await client.query<{ auth_user_id: string }>(
        "select auth_user_id from user_accounts where customer_id=$1 order by auth_user_id",
        [customer.id],
      );
      const requests = await client.query<{ count: string }>(
        `select count(*)::text count from service_requests where contract_id=any($1::uuid[])`,
        [contracts.rows.map((contract) => contract.id)],
      );
      const estimates = await client.query<{ count: string }>(
        `select count(*)::text count from estimates e join service_requests r on r.id=e.request_id
          where r.contract_id=any($1::uuid[])`,
        [contracts.rows.map((contract) => contract.id)],
      );
      const applications = await client.query<{ count: string }>(
        "select count(*)::text count from applications where customer_id=$1",
        [customer.id],
      );
      const notifications = await client.query<{ count: string }>(
        "select count(*)::text count from notifications where customer_id=$1 and sent_at is null",
        [customer.id],
      );
      if (!result.dryRun) {
        await client.query(
          `update customers set shop_name='削除済み',contact_name='削除済み',billing_name='削除済み',
             billing_address='削除済み',email='deleted+'||id::text||'@invalid.example',phone=null,
             line_display_name=null,line_user_id=null,invoice_reg_no=null,marketing_opt_in=false,
             anonymized_at=transaction_timestamp()
           where id=$1 and anonymized_at is null`,
          [customer.id],
        );
        await client.query(
          `update service_requests set summary='（削除済み）'
            where contract_id=any($1::uuid[])`,
          [contracts.rows.map((contract) => contract.id)],
        );
        await client.query(
          `update estimates e set work_items='["（削除済み）"]'::jsonb,
             done_criteria='（削除済み）',exclusions='（削除済み）',customer_prep='（削除済み）'
            from service_requests r where r.id=e.request_id and r.contract_id=any($1::uuid[])`,
          [contracts.rows.map((contract) => contract.id)],
        );
        await client.query(
          `update applications set free_text=null,rejection_note=null,ip_address=null,user_agent=null
            where customer_id=$1`,
          [customer.id],
        );
        await client.query(
          `update leads set shop_name='削除済み',note=null where customer_id=$1`,
          [customer.id],
        );
        await client.query(
          `update notifications set payload='{}'::jsonb,last_error=null
            where customer_id=$1 and sent_at is not null`,
          [customer.id],
        );
        await client.query(
          "delete from notifications where customer_id=$1 and sent_at is null",
          [customer.id],
        );
        await client.query("delete from user_accounts where customer_id=$1", [
          customer.id,
        ]);
      }
      await client.query("commit");
      result.customers++;
      result.serviceRequests += Number(requests.rows[0]?.count ?? 0);
      result.estimates += Number(estimates.rows[0]?.count ?? 0);
      result.applications += Number(applications.rows[0]?.count ?? 0);
      result.pendingNotifications += Number(notifications.rows[0]?.count ?? 0);
      result.authUserIds.push(...users.rows.map((user) => user.auth_user_id));
    } catch (error) {
      console.error(
        "retention purge failed for a customer",
        candidate.id,
        error instanceof Error ? error.name : "UnknownError",
      );
      await client.query("rollback");
      result.failed++;
    } finally {
      client.release();
    }
  }
  return result;
}
