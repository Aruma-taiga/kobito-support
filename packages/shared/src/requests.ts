import { z } from "zod";
import { validationMessages } from "./messages.js";
import { type RequestStatus, requestStatuses } from "./states.js";

const date = z.iso.date({ error: validationMessages.date });
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, validationMessages.required)
    .max(max, validationMessages.maxLength);

export const createRequestSchema = z
  .object({
    contractId: z.uuid(),
    receivedOn: date,
    summary: text(500),
    urgent: z.boolean(),
  })
  .strict();
export type CreateRequest = z.infer<typeof createRequestSchema>;

export const createEstimateSchema = z
  .object({
    credits: z.number().int().positive().max(1000),
    dueOn: date,
    workItems: z.array(text(300)).min(1).max(30),
    doneCriteria: text(2000),
    exclusions: z.string().trim().max(2000).nullable().optional(),
    customerPrep: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type CreateEstimate = z.infer<typeof createEstimateSchema>;
export const approveEstimateSchema = z.object({}).strict();

export const completeRequestSchema = z
  .object({
    completedOn: date,
    actualMinutes: z
      .number({ error: validationMessages.nonnegativeInteger })
      .int({ error: validationMessages.nonnegativeInteger })
      .min(0, { error: validationMessages.nonnegativeInteger })
      .max(2_147_483_647, { error: validationMessages.nonnegativeInteger }),
    actualCredits: z
      .number({ error: validationMessages.nonnegativeInteger })
      .int({ error: validationMessages.nonnegativeInteger })
      .min(0, { error: validationMessages.nonnegativeInteger })
      .max(2_147_483_647, { error: validationMessages.nonnegativeInteger }),
  })
  .strict();
export type CompleteRequest = z.infer<typeof completeRequestSchema>;

export interface RequestCompletion {
  completedOn: string;
  actualMinutes: number;
  actualCredits: number;
  reservedCredits: number;
  periodId: string;
  reservedPeriod: { startsOn: string; endsOn: string };
}

export interface RequestEstimate {
  id: string;
  requestId: string;
  version: number;
  credits: number;
  dueOn: string;
  workItems: string[];
  doneCriteria: string;
  exclusions: string | null;
  customerPrep: string | null;
  sentAt: string;
  approvedAt: string | null;
  supersededAt: string | null;
}
export interface AdminRequestSummary {
  id: string;
  contractId: string;
  receivedOn: string;
  summary: string;
  urgent: boolean;
  status: RequestStatus;
  createdAt: string;
  latestEstimate: RequestEstimate | null;
  completion: RequestCompletion | null;
}
export interface CustomerRequestSummary extends AdminRequestSummary {
  approvedEstimateId: string | null;
}
export interface AdminRequestDetail extends AdminRequestSummary {
  customer: { customerId: string; shopName: string; contactName: string };
  estimates: RequestEstimate[];
}
export interface CustomerRequestDetail {
  request: CustomerRequestSummary;
  latestEstimate: RequestEstimate | null;
  currentPeriodId: string | null;
  availableCredits: number;
  canApprove: boolean;
}
export interface EligibleRequestContracts {
  items: Array<{
    contractId: string;
    customerId: string;
    shopName: string;
    contactName: string;
    status: "active" | "cancel_scheduled";
  }>;
}
export interface ApproveEstimateResponse {
  requestId: string;
  estimateId: string;
  status: "in_progress";
  approvedAt: string;
  reservedCredits: number;
  replayed: boolean;
}
export interface CompleteRequestResponse extends RequestCompletion {
  requestId: string;
  status: "done";
  replayed: boolean;
}

export const requestEstimateSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  version: z.number().int().positive(),
  credits: z.number().int().positive(),
  dueOn: date,
  workItems: z.array(z.string()),
  doneCriteria: z.string(),
  exclusions: z.string().nullable(),
  customerPrep: z.string().nullable(),
  sentAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
  supersededAt: z.iso.datetime().nullable(),
});
export const requestCompletionSchema = z.object({
  completedOn: date,
  actualMinutes: z.number().int().nonnegative(),
  actualCredits: z.number().int().nonnegative(),
  reservedCredits: z.number().int().positive(),
  periodId: z.uuid(),
  reservedPeriod: z.object({ startsOn: date, endsOn: date }),
});
export const adminRequestSummarySchema = z.object({
  id: z.uuid(),
  contractId: z.uuid(),
  receivedOn: date,
  summary: z.string(),
  urgent: z.boolean(),
  status: z.enum(requestStatuses),
  createdAt: z.iso.datetime(),
  latestEstimate: requestEstimateSchema.nullable(),
  completion: requestCompletionSchema.nullable(),
});
export const customerRequestSummarySchema = adminRequestSummarySchema.extend({
  approvedEstimateId: z.uuid().nullable(),
});
export const createRequestResponseSchema = z.object({
  id: z.uuid(),
  contractId: z.uuid(),
  receivedOn: date,
  summary: z.string(),
  urgent: z.boolean(),
  status: z.enum(requestStatuses),
  createdAt: z.iso.datetime(),
  replayed: z.boolean(),
});
export const createEstimateResponseSchema = requestEstimateSchema.extend({
  replayed: z.boolean(),
});
export type CreateRequestResponse = z.infer<typeof createRequestResponseSchema>;
export type CreateEstimateResponse = z.infer<
  typeof createEstimateResponseSchema
>;
export const eligibleRequestContractsSchema = z.object({
  items: z.array(
    z.object({
      contractId: z.uuid(),
      customerId: z.uuid(),
      shopName: z.string(),
      contactName: z.string(),
      status: z.enum(["active", "cancel_scheduled"]),
    }),
  ),
});
export const adminRequestListSchema = z.object({
  items: z.array(adminRequestSummarySchema),
});
export const adminRequestDetailSchema = adminRequestSummarySchema.extend({
  customer: z.object({
    customerId: z.uuid(),
    shopName: z.string(),
    contactName: z.string(),
  }),
  estimates: z.array(requestEstimateSchema),
});
export const customerRequestListSchema = z.object({
  items: z.array(customerRequestSummarySchema),
});
export const customerRequestDetailSchema = z.object({
  request: customerRequestSummarySchema,
  latestEstimate: requestEstimateSchema.nullable(),
  currentPeriodId: z.uuid().nullable(),
  availableCredits: z.number().int(),
  canApprove: z.boolean(),
});
export const approveEstimateResponseSchema = z.object({
  requestId: z.uuid(),
  estimateId: z.uuid(),
  status: z.literal("in_progress"),
  approvedAt: z.iso.datetime(),
  reservedCredits: z.number().int().positive(),
  replayed: z.boolean(),
});
export const completeRequestResponseSchema = requestCompletionSchema.extend({
  requestId: z.uuid(),
  status: z.literal("done"),
  replayed: z.boolean(),
});
