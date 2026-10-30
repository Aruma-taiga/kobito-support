import type { CustomerScope } from "../../../platform/scope.js";
import { ApiError } from "../../../platform/types.js";
import type {
  FirebaseCustomTokenIssuer,
  LineRepository,
  LineTokenVerifier,
} from "./contracts.js";

export class LineService {
  constructor(
    private readonly repository: LineRepository,
    private readonly verifier: LineTokenVerifier | undefined,
    private readonly tokens: FirebaseCustomTokenIssuer,
  ) {}
  private async identity(token: string) {
    if (!this.verifier) throw new ApiError(503, "service_unavailable");
    try {
      return await this.verifier.verify(token);
    } catch {
      throw new ApiError(401, "unauthorized");
    }
  }
  async signIn(idToken: string) {
    const line = await this.identity(idToken);
    const account = await this.repository.findLinkedAccount(line.sub);
    if (!account) throw new ApiError(404, "not_found");
    try {
      return {
        customToken: await this.tokens.createCustomToken(account.authUserId),
        authUserId: account.authUserId,
      };
    } catch {
      throw new ApiError(503, "service_unavailable");
    }
  }
  async link(scope: CustomerScope, idToken: string) {
    if (!this.verifier) throw new ApiError(503, "service_unavailable");
    let line: { sub: string };
    try {
      line = await this.verifier.verify(idToken);
    } catch {
      throw new ApiError(400, "invalid_line_token");
    }
    await this.repository.link(scope, line.sub);
    return { linked: true as const };
  }
  async status(scope: CustomerScope) {
    if (!this.verifier) throw new ApiError(503, "service_unavailable");
    return { linked: await this.repository.status(scope) };
  }
}
