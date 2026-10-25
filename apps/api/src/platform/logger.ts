import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { ApiVariables } from "./types.js";

export interface ApiLogger {
  info(event: {
    requestId: string;
    method: string;
    route: string;
    status: number;
    durationMs: number;
  }): void;
  error(event: {
    requestId: string;
    method: string;
    route: string;
    status: number;
    durationMs: number;
  }): void;
}

export const consoleLogger: ApiLogger = {
  info: (event) => console.info(JSON.stringify(event)),
  error: (event) => console.error(JSON.stringify(event)),
};

export function requestLogger(
  logger: ApiLogger,
): MiddlewareHandler<{ Variables: ApiVariables }> {
  return async (context, next) => {
    const requestId = randomUUID();
    context.set("requestId", requestId);
    context.header("X-Request-ID", requestId);
    const start = performance.now();
    await next();
    const event = {
      requestId,
      method: context.req.method,
      route: context.req.routePath || "unmatched",
      status: context.res.status,
      durationMs: Math.max(0, Math.round(performance.now() - start)),
    };
    if (event.status >= 500) logger.error(event);
    else logger.info(event);
  };
}
