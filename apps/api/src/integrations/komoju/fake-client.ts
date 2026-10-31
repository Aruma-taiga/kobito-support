import type {
  HostedSession,
  HostedSessionRequest,
  KomojuClient,
} from "./client.js";

export class FakeKomojuClient implements KomojuClient {
  readonly requests: HostedSessionRequest[] = [];

  constructor(
    private readonly result: HostedSession = {
      sessionId: "fake-session-id",
      redirectUrl: "https://komoju.com/sessions/fake-session-id",
    },
    private readonly failure?: Error,
  ) {}

  async createHostedSession(
    request: HostedSessionRequest,
  ): Promise<HostedSession> {
    this.requests.push(request);
    if (this.failure) throw this.failure;
    return this.result;
  }
}
