import { applicationSubmissionSchema, type PublicPlans } from "@kobito/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type {
  IdentityVerifier,
  VerifiedIdentity,
} from "../../platform/auth.js";
import { ApiError } from "../../platform/types.js";
import type { ApplicationsModule } from "./contracts.js";

const maxApplicationBodyBytes = 32 * 1024;

function parseBearerToken(header: string | undefined): string | undefined {
  return /^Bearer ([^\s]+)$/i.exec(header ?? "")?.[1];
}

export function createApplicationRoutes(dependencies: {
  verifier: IdentityVerifier;
  applications: ApplicationsModule;
}) {
  const routes = new Hono();

  routes.get("/public/plans", async (context) => {
    const catalog = await dependencies.applications.getPublicCatalog();
    const response: PublicPlans = {
      plans: catalog.plans,
      displayVersion: catalog.displayVersion,
    };
    return context.json(response);
  });

  routes.get("/public/partners/:code", async (context) => {
    const code = context.req.param("code").trim();
    if (!code || code.length > 100) throw new ApiError(404, "not_found");
    const partner = await dependencies.applications.getPublicPartner(code);
    return context.json(partner);
  });

  routes.post(
    "/applications",
    bodyLimit({
      maxSize: maxApplicationBodyBytes,
      onError: (context) =>
        context.json({ error: { code: "invalid_request" } }, 400),
    }),
    async (context) => {
      const contentType = context.req
        .header("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json") {
        throw new ApiError(400, "invalid_request");
      }

      const rawIdempotencyKey = context.req.header("idempotency-key");
      if (!rawIdempotencyKey) throw new ApiError(400, "invalid_request");

      let rawSubmission: unknown;
      try {
        rawSubmission = await context.req.json();
      } catch {
        throw new ApiError(400, "invalid_request");
      }
      const parsedSubmission =
        applicationSubmissionSchema.safeParse(rawSubmission);
      if (!parsedSubmission.success) {
        throw new ApiError(422, "validation_error");
      }

      const token = parseBearerToken(context.req.header("authorization"));
      if (!token) throw new ApiError(401, "unauthorized");

      let identity: VerifiedIdentity;
      try {
        identity = await dependencies.verifier.verifyIdToken(token, true);
      } catch {
        throw new ApiError(401, "unauthorized");
      }
      if (!identity.uid || !identity.email) {
        throw new ApiError(401, "unauthorized");
      }
      if (
        identity.email.trim().toLowerCase() !==
        parsedSubmission.data.email.trim().toLowerCase()
      ) {
        throw new ApiError(401, "unauthorized");
      }

      const userAgent = context.req.header("user-agent");
      const receipt = await dependencies.applications.submit({
        identity,
        idempotencyKey: rawIdempotencyKey,
        submission: parsedSubmission.data,
        requestContext: userAgent ? { userAgent: userAgent.slice(0, 512) } : {},
      });
      return context.json(receipt, receipt.replayed ? 200 : 201);
    },
  );

  return routes;
}
