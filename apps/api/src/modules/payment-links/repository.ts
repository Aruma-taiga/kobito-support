import type { Pool } from "pg";
import { ApiError } from "../../platform/types.js";
import type { PaymentLinkRepository } from "./contracts.js";

export class PostgresPaymentLinkRepository implements PaymentLinkRepository {
  constructor(private readonly pool: Pool) {}

  async getCustomerInvoice(scope: { customerId: string }, invoiceId: string) {
    const result = await this.pool.query<{
      invoice_no: string;
      total_incl_tax: number;
      payment_method: string;
      status: string;
    }>(
      `select i.invoice_no, i.total_incl_tax, i.payment_method, i.status
         from invoices i join contracts c on c.id=i.contract_id
        where c.customer_id=$1 and i.id=$2 and i.kind in ('initial','monthly')`,
      [scope.customerId, invoiceId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "not_found");
    return {
      invoiceNo: row.invoice_no,
      amountYen: row.total_incl_tax,
      paymentMethod: row.payment_method,
      status: row.status,
    };
  }

  async recordCustomerLinkCreated(
    scope: { customerId: string },
    authUserId: string,
    invoiceId: string,
  ) {
    await this.pool.query(
      `insert into audit_logs (actor, action, target_type, target_id, detail)
       select $1, 'invoice.payment_link.created', 'invoice', i.id, '{}'::jsonb
         from invoices i join contracts c on c.id=i.contract_id
        where c.customer_id=$2 and i.id=$3 and i.kind in ('initial','monthly')`,
      [authUserId, scope.customerId, invoiceId],
    );
  }
}
