import type { Pool, PoolClient } from "pg";

export async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the operation/audit failure; do not expose the database error.
    }
    throw error;
  } finally {
    client.release();
  }
}
