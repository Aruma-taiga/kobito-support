import type { Pool } from "pg";
import type { CustomerScope } from "../../../platform/scope.js";
import { ApiError } from "../../../platform/types.js";
import type { LineRepository } from "./contracts.js";

export class PostgresLineRepository implements LineRepository {
  constructor(private readonly pool: Pool) {}
  async findLinkedAccount(lineUserId: string) {
    const result = await this.pool.query<{ auth_user_id: string }>(
      `select ua.auth_user_id from customers c
       join user_accounts ua on ua.customer_id = c.id and ua.role = 'customer'
       where c.line_user_id = $1 and c.anonymized_at is null
       order by ua.created_at, ua.auth_user_id`,
      [lineUserId],
    );
    return result.rows[0]
      ? { authUserId: result.rows[0].auth_user_id }
      : undefined;
  }
  async status(scope: CustomerScope) {
    const result = await this.pool.query<{ linked: boolean }>(
      `select (line_user_id is not null) as linked from customers where id=$1 and anonymized_at is null`,
      [scope.customerId],
    );
    if (!result.rows[0]) throw new ApiError(404, "not_found");
    return result.rows[0].linked;
  }
  async link(scope: CustomerScope, lineUserId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const locked = await client.query<{ line_user_id: string | null }>(
        "select line_user_id from customers where id=$1 and anonymized_at is null for update",
        [scope.customerId],
      );
      if (!locked.rows[0]) throw new ApiError(404, "not_found");
      const existing = locked.rows[0].line_user_id;
      if (existing === lineUserId) {
        await client.query("commit");
        return;
      }
      if (existing !== null) throw new ApiError(409, "conflict");
      await client.query("update customers set line_user_id=$2 where id=$1", [
        scope.customerId,
        lineUserId,
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        throw new ApiError(409, "conflict");
      throw error;
    } finally {
      client.release();
    }
  }
}
