import type { Pool } from "pg";
import { z } from "zod";

const serviceNameSchema = z.string().trim().min(1).max(120);

const contactEmailSchema = z.string().trim().email().max(254);

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

  /** Optional: a missing or invalid value hides the address instead of failing. */
  async getContactEmail(): Promise<string | null> {
    const result = await this.pool.query<{ value: unknown }>(
      "select value from settings where key = $1",
      ["contact_email"],
    );
    const parsed = contactEmailSchema.safeParse(result.rows[0]?.value);
    return parsed.success ? parsed.data : null;
  }
}
