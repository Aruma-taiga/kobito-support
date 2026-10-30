import { Pool, type PoolConfig } from "pg";

export function createPool(
  connectionString: string,
  options: Omit<PoolConfig, "connectionString"> = {},
): Pool {
  return new Pool({ connectionString, ...options });
}
