import {
  calendarDaysBetween,
  type RetentionItem,
  retentionDueDate,
  retentionListSchema,
  toTokyoDate,
} from "@kobito/shared";
import type { Pool } from "pg";
import type { RetentionModule } from "./retention-contracts.js";

interface RetentionRow {
  customer_id: string;
  shop_name: string;
  due_date: string;
  status: "ended" | "lapsed" | "declined";
  transition_date: string | null;
}

export class RetentionRepository implements RetentionModule {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listRetention(): Promise<RetentionItem[]> {
    const today = toTokyoDate(this.now());
    const result = await this.pool.query<RetentionRow>(
      `select cu.id customer_id,cu.shop_name,cu.deletion_due_on::text due_date,
              c.status,
              case when c.status='ended' then to_char(c.ended_at at time zone 'Asia/Tokyo','YYYY-MM-DD')
                   when c.status='declined' then to_char(a.reviewed_at at time zone 'Asia/Tokyo','YYYY-MM-DD')
                   when c.status='lapsed' then lifecycle.transition_date
                   else null end transition_date
         from customers cu
         join contracts c on c.customer_id=cu.id and c.status in ('ended','lapsed','declined')
         left join applications a on a.id=c.application_id
         left join lateral (
           select detail->>'transitionDate' transition_date from audit_logs
            where target_type='contract' and target_id=c.id::text and action='contract.lapsed'
            order by at desc limit 1
         ) lifecycle on true
        where cu.deletion_due_on is not null and cu.anonymized_at is null
        order by cu.deletion_due_on,cu.shop_name,c.id`,
    );
    const byCustomer = new Map<string, RetentionRow>();
    const matchedSchedule = new Set<string>();
    for (const row of result.rows) {
      const matchesPersistedDate =
        row.transition_date !== null &&
        retentionDueDate(row.status, row.transition_date) === row.due_date;
      const previous = byCustomer.get(row.customer_id);
      if (matchesPersistedDate) {
        byCustomer.set(row.customer_id, row);
        matchedSchedule.add(row.customer_id);
      } else if (
        !matchedSchedule.has(row.customer_id) &&
        (!previous || row.due_date >= previous.due_date)
      ) {
        byCustomer.set(row.customer_id, row);
      }
    }
    const items = [...byCustomer.values()].map((row) => {
      // Older lapsed rows have no transition log; infer the base date from the persisted due date.
      const baseDate =
        row.transition_date ??
        `${String(Number(row.due_date.slice(0, 4)) - 1).padStart(4, "0")}${row.due_date.slice(4)}`;
      retentionDueDate(row.status, baseDate);
      return {
        customerId: row.customer_id,
        shopName: row.shop_name,
        status: row.status,
        baseDate,
        dueDate: row.due_date,
        daysRemaining: calendarDaysBetween(today, row.due_date),
      };
    });
    return retentionListSchema.parse(items);
  }
}
