import type {
  ApplicationReceipt,
  ApplicationSubmission,
  PublicApplicationConfig,
  PublicPartner,
  PublicPlan,
} from "@kobito/shared";
import type { VerifiedIdentity } from "../../platform/auth.js";

export interface PublicApplicationCatalog {
  plans: PublicPlan[];
  displayVersion: string;
  application: PublicApplicationConfig | null;
}

export interface ApplicationRequestContext {
  userAgent?: string;
}

export interface SubmitApplicationCommand {
  identity: VerifiedIdentity;
  idempotencyKey: string;
  submission: ApplicationSubmission;
  requestContext: ApplicationRequestContext;
}

export interface ApplicationsModule {
  getPublicCatalog(): Promise<PublicApplicationCatalog>;
  getPublicPartner(code: string): Promise<PublicPartner>;
  submit(command: SubmitApplicationCommand): Promise<ApplicationReceipt>;
}
