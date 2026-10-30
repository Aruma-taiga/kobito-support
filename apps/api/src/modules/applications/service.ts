import { z } from "zod";
import type { RuntimeConfig } from "../../platform/config.js";
import { ApiError } from "../../platform/types.js";
import type {
  ApplicationsModule,
  PublicApplicationCatalog,
  SubmitApplicationCommand,
} from "./contracts.js";
import type { ApplicationsRepositoryPort } from "./repository.js";

const idempotencyKeySchema = z.string().uuid();

export class ApplicationsService implements ApplicationsModule {
  constructor(
    private readonly repository: ApplicationsRepositoryPort,
    private readonly config: RuntimeConfig,
  ) {}

  getPublicCatalog(): Promise<PublicApplicationCatalog> {
    return this.repository.getPublicCatalog(this.config);
  }

  getPublicPartner(code: string) {
    return this.repository.getPublicPartner(code.trim());
  }

  async submit(command: SubmitApplicationCommand) {
    if (!idempotencyKeySchema.safeParse(command.idempotencyKey).success) {
      throw new ApiError(400, "invalid_request");
    }

    const tokenEmail = command.identity.email?.trim().toLowerCase();
    const submittedEmail = command.submission.email.trim().toLowerCase();
    if (!command.identity.uid || !tokenEmail || tokenEmail !== submittedEmail) {
      throw new ApiError(401, "unauthorized");
    }

    return this.repository.submit(
      command,
      this.config,
      this.config.operationsEmail,
    );
  }
}
