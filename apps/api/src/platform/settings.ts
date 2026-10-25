import type { Pool } from "pg";
import { z } from "zod";

const serviceNameSchema = z.string().trim().min(1).max(120);

export class PublicSettingsRepository {
  constructor(private readonly pool: Pool) {}

  async getServiceName(): Promise<string> {
    const result = await this.pool.query<{ value: unknown }>(
      "select value from settings where key = $1",
      ["service_name"],
    );
    const parsed = serviceNameSchema.safeParse(result.rows[0]?.value);
    if (!parsed.success)
      throw new Error("Public service name is not configured");
    return parsed.data;
  }
}
