import { z } from "zod";

export const publicConfigSchema = z.strictObject({
  serviceName: z.string().trim().min(1).max(120),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;

export const meResponseSchema = z.strictObject({
  customer: z.strictObject({
    id: z.string().uuid(),
    shopName: z.string().min(1),
    contactName: z.string().min(1),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
