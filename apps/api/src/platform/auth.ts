import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { MiddlewareHandler } from "hono";
import type { RuntimeConfig } from "./config.js";
import { ApiError, type ApiVariables, type Principal } from "./types.js";

export interface VerifiedIdentity {
  uid: string;
  email?: string | undefined;
  firebase?: { sign_in_second_factor?: unknown };
}

export interface IdentityVerifier {
  verifyIdToken(
    token: string,
    checkRevoked?: boolean,
  ): Promise<VerifiedIdentity>;
}

export interface AccountLookup {
  findByAuthUserId(authUserId: string): Promise<
    | {
        authUserId: string;
        role: "customer" | "admin";
        customerId: string | null;
      }
    | undefined
  >;
}

export type { Principal } from "./types.js";

export function createFirebaseVerifier(
  config: RuntimeConfig,
): IdentityVerifier {
  if (config.nodeEnv === "production" && config.authEmulatorHost) {
    throw new Error("Firebase Auth Emulator is forbidden in production");
  }
  if (
    config.nodeEnv !== "development" &&
    config.firebaseProjectId.startsWith("demo-")
  ) {
    throw new Error("Demo Firebase projects are local-development only");
  }
  const app =
    getApps().find((candidate) => candidate.name === "kobito-api") ??
    initializeApp({ projectId: config.firebaseProjectId }, "kobito-api");
  return {
    verifyIdToken: async (token, checkRevoked = false) =>
      getAuth(app).verifyIdToken(token, checkRevoked),
  };
}

function extractBearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer ([^\s]+)$/i.exec(header ?? "");
  return match?.[1];
}

export function createAuthenticate(
  verifier: IdentityVerifier,
  accounts: AccountLookup,
): MiddlewareHandler<{ Variables: ApiVariables }> {
  return async (context, next) => {
    const token = extractBearerToken(context.req.header("authorization"));
    if (!token) throw new ApiError(401, "unauthorized");

    let identity: VerifiedIdentity;
    try {
      identity = await verifier.verifyIdToken(token);
    } catch {
      throw new ApiError(401, "unauthorized");
    }
    if (!identity.uid) throw new ApiError(401, "unauthorized");

    const account = await accounts.findByAuthUserId(identity.uid);
    if (!account || (account.role === "customer" && !account.customerId)) {
      throw new ApiError(401, "unauthorized");
    }

    const factor = identity.firebase?.sign_in_second_factor;
    context.set("principal", {
      authUserId: account.authUserId,
      role: account.role,
      customerId: account.customerId,
      secondFactor: typeof factor === "string" && factor.trim() ? factor : null,
    });
    await next();
  };
}

export function requireCustomer(): MiddlewareHandler<{
  Variables: ApiVariables;
}> {
  return async (context, next) => {
    const principal = context.get("principal");
    if (principal.role !== "customer") throw new ApiError(404, "not_found");
    if (!principal.customerId) throw new ApiError(401, "unauthorized");
    await next();
  };
}

export function requireAdmin(): MiddlewareHandler<{
  Variables: ApiVariables;
}> {
  return async (context, next) => {
    const principal: Principal = context.get("principal");
    if (principal.role !== "admin") throw new ApiError(404, "not_found");
    if (!principal.secondFactor) throw new ApiError(403, "forbidden");
    await next();
  };
}
