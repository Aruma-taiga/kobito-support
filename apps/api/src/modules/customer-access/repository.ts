import type { Pool } from "pg";
import { withTransaction } from "../../platform/db/transaction.js";
import type { CustomerScope } from "../../platform/scope.js";
import { ApiError } from "../../platform/types.js";

export interface CustomerLifecycleState {
  status:
    | "under_review"
    | "quoting"
    | "awaiting_quote_approval"
    | "awaiting_payment"
    | "active"
    | "cancel_scheduled"
    | "ended"
    | "declined"
    | "lapsed"
    | null;
  welcomeShownAt: string | null;
  endedOnTokyoDate: string | null;
}

export interface CustomerAccessRepository {
  findLifecycleState(scope: CustomerScope): Promise<CustomerLifecycleState>;
  markWelcomeSeen(scope: CustomerScope): Promise<string>;
}

export class PostgresCustomerAccessRepository
  implements CustomerAccessRepository
{
  constructor(
    private readonly pool: Pool,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async findLifecycleState(
    scope: CustomerScope,
  ): Promise<CustomerLifecycleState> {
    const result = await this.pool.query<{
      status: CustomerLifecycleState["status"];
      welcome_shown_at: Date | null;
      ended_on_tokyo_date: string | null;
    }>(
      `select c.status, c.welcome_shown_at,
              to_char(c.ended_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as ended_on_tokyo_date
         from customers customer
         left join lateral (
           select status, welcome_shown_at, ended_at
             from contracts
            where customer_id = customer.id
            order by created_at desc, id desc
            limit 1
         ) c on true
        where customer.id = $1 and customer.anonymized_at is null`,
      [scope.customerId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "not_found");
    return {
      status: row.status,
      welcomeShownAt: row.welcome_shown_at?.toISOString() ?? null,
      endedOnTokyoDate: row.ended_on_tokyo_date,
    };
  }

  async markWelcomeSeen(scope: CustomerScope): Promise<string> {
    return withTransaction(this.pool, async (client) => {
      const selected = await client.query<{
        id: string;
        status: string;
        welcome_shown_at: Date | null;
      }>(
        `select contract.id, contract.status, contract.welcome_shown_at
           from contracts contract
           join customers customer on customer.id=contract.customer_id
          where contract.customer_id = $1 and customer.anonymized_at is null
          order by contract.created_at desc, contract.id desc
          limit 1 for update of contract`,
        [scope.customerId],
      );
      const contract = selected.rows[0];
      if (
        !contract ||
        (contract.status !== "active" && contract.status !== "cancel_scheduled")
      ) {
        const customer = await client.query(
          "select 1 from customers where id=$1 and anonymized_at is null",
          [scope.customerId],
        );
        if (customer.rowCount === 0) throw new ApiError(404, "not_found");
        throw new ApiError(409, "request_conflict");
      }

      const now = this.clock();
      if (!Number.isFinite(now.getTime())) throw new Error("Invalid clock");
      const updated = await client.query<{ welcome_shown_at: Date }>(
        `update contracts set welcome_shown_at = coalesce(welcome_shown_at, $2)
          where id = $1 and status in ('active','cancel_scheduled')
          returning welcome_shown_at`,
        [contract.id, now],
      );
      const timestamp = updated.rows[0]?.welcome_shown_at;
      if (!timestamp) throw new ApiError(409, "request_conflict");
      return timestamp.toISOString();
    });
  }
}
