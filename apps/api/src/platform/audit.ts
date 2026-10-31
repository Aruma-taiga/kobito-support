import type { Pool, PoolClient } from "pg";
import { withTransaction } from "./db/transaction.js";
import { ApiError, type Principal } from "./types.js";

export interface AuditEvent {
  action: string;
  targetType: string;
  targetId: string;
  detail?: Readonly<Record<string, unknown>>;
}

const detailKeys = new Set([
  "reasonCode",
  "fromStatus",
  "toStatus",
  "resourceId",
  "endsOn",
  "removalRequested",
  "removablePermissionsRemoved",
  "checklistComplete",
  "outcome",
]);

function safeText(value: string, maxLength: number): boolean {
  if (value.length === 0 || value.length > maxLength) return false;
  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 31 && codePoint !== 127;
  });
}

function safeIdentifier(value: string, maxLength: number): boolean {
  return safeText(value, maxLength) && /^[A-Za-z0-9_.:-]+$/.test(value);
}

function allowlistedDetail(
  detail: AuditEvent["detail"],
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(detail ?? {})) {
    if (!detailKeys.has(key)) continue;
    if (typeof value === "string" && safeIdentifier(value, 100)) {
      safe[key] = value;
    }
  }
  return safe;
}

export async function withAdminAudit<T>(
  pool: Pool,
  principal: Principal,
  event: AuditEvent,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (principal.role !== "admin") throw new ApiError(404, "not_found");
  if (!principal.secondFactor) throw new ApiError(403, "forbidden");
  if (
    !/^[a-z][a-z0-9_.-]{0,99}$/.test(event.action) ||
    !safeIdentifier(event.targetType, 80) ||
    !safeIdentifier(event.targetId, 128)
  ) {
    throw new ApiError(500, "internal_error");
  }

  return withTransaction(pool, async (client) => {
    const result = await operation(client);
    await client.query(
      `insert into audit_logs (actor, action, target_type, target_id, detail)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [
        principal.authUserId,
        event.action,
        event.targetType,
        event.targetId,
        JSON.stringify(allowlistedDetail(event.detail)),
      ],
    );
    return result;
  });
}
