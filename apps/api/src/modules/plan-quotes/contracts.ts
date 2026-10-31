import type {
  AdminPlanQuote,
  ApprovePlanQuoteResponse,
  CreatePlanQuoteResponse,
  CustomerPlanQuote,
} from "@kobito/shared";
import type { CustomerScope } from "../../platform/scope.js";
import type { Principal } from "../../platform/types.js";

export interface PlanQuoteModule {
  getAdmin(principal: Principal, customerId: string): Promise<AdminPlanQuote>;
  createAdmin(
    principal: Principal,
    customerId: string,
    body: unknown,
  ): Promise<CreatePlanQuoteResponse>;
  getCustomer(scope: CustomerScope): Promise<CustomerPlanQuote>;
  approveCustomer(
    scope: CustomerScope,
    principal: Principal,
    quoteId: string,
  ): Promise<ApprovePlanQuoteResponse>;
}
