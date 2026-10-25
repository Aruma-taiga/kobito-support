import { ApiError } from "../types.js";

/** Prevent PostgreSQL messages, values, and connection details from reaching clients. */
export function toApiDatabaseError(_error: unknown): ApiError {
  return new ApiError(500, "internal_error");
}
