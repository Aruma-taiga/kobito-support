import { z } from "zod";

export const lineTokenRequestSchema = z
  .object({
    idToken: z.string().min(1).max(16_384),
  })
  .strict();
export const lineSignInResponseSchema = z
  .object({
    customToken: z.string().min(1),
    authUserId: z.string().min(1),
  })
  .strict();
export const lineLinkResponseSchema = z
  .object({ linked: z.literal(true) })
  .strict();
export const lineLinkStatusResponseSchema = z
  .object({ linked: z.boolean() })
  .strict();

export const lineValidationMessages = {
  idTokenRequired: "LINEの認証情報を確認してください。",
} as const;
