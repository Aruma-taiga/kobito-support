import { z } from "zod";
import { addCalendarYear, previousCalendarDay } from "./retention.js";
import { contractStatuses } from "./states.js";

export const customerLandingPaths = [
  "/me/waiting",
  "/me/plan-quote",
  "/me/welcome",
  "/me",
  "/me/invoices",
  "/me/finished",
] as const;

export const customerAccessSchema = z.strictObject({
  contractStatus: z.enum(contractStatuses).nullable(),
  landingPath: z.enum(customerLandingPaths),
  access: z.enum(["pending", "active", "ended", "finished", "none"]),
  welcomeRequired: z.boolean(),
  invoiceAccess: z.boolean(),
  invoiceAccessUntil: z.iso.date().nullable(),
});
export type CustomerAccess = z.infer<typeof customerAccessSchema>;

export const welcomeSeenResponseSchema = z.object({
  seenAt: z.iso.datetime(),
});
export type WelcomeSeenResponse = z.infer<typeof welcomeSeenResponseSchema>;

export function customerAccessFor(input: {
  status: (typeof contractStatuses)[number] | null;
  welcomeShownAt: string | null;
  endedOnTokyoDate: string | null;
  todayTokyoDate: string;
}): CustomerAccess {
  const { status } = input;
  if (status === null) {
    return {
      contractStatus: null,
      landingPath: "/me",
      access: "none",
      welcomeRequired: false,
      invoiceAccess: false,
      invoiceAccessUntil: null,
    };
  }
  if (["under_review", "quoting", "awaiting_payment"].includes(status)) {
    return {
      contractStatus: status,
      landingPath: "/me/waiting",
      access: "pending",
      welcomeRequired: false,
      invoiceAccess: true,
      invoiceAccessUntil: null,
    };
  }
  if (status === "awaiting_quote_approval") {
    return {
      contractStatus: status,
      landingPath: "/me/plan-quote",
      access: "pending",
      welcomeRequired: false,
      invoiceAccess: false,
      invoiceAccessUntil: null,
    };
  }
  if (status === "active" || status === "cancel_scheduled") {
    const welcomeRequired = input.welcomeShownAt === null;
    return {
      contractStatus: status,
      landingPath: welcomeRequired ? "/me/welcome" : "/me",
      access: "active",
      welcomeRequired,
      invoiceAccess: true,
      invoiceAccessUntil: null,
    };
  }
  if (status === "ended" && input.endedOnTokyoDate !== null) {
    const invoiceAccessUntil = previousCalendarDay(
      addCalendarYear(input.endedOnTokyoDate),
    );
    if (input.todayTokyoDate <= invoiceAccessUntil) {
      return {
        contractStatus: status,
        landingPath: "/me/invoices",
        access: "ended",
        welcomeRequired: false,
        invoiceAccess: true,
        invoiceAccessUntil,
      };
    }
  }
  return {
    contractStatus: status,
    landingPath: "/me/finished",
    access: "finished",
    welcomeRequired: false,
    invoiceAccess: false,
    invoiceAccessUntil: null,
  };
}
