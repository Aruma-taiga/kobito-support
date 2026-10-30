import type { CustomerAccess, WelcomeSeenResponse } from "@kobito/shared";
import type { CustomerScope } from "../../platform/scope.js";

export interface CustomerAccessModule {
  getAccess(scope: CustomerScope): Promise<CustomerAccess>;
  markWelcomeSeen(scope: CustomerScope): Promise<WelcomeSeenResponse>;
}
