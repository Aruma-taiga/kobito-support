export interface VerifiedLineIdentity {
  sub: string;
}

export class LineIdTokenVerifier {
  constructor(
    private readonly channelId: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async verify(idToken: string): Promise<VerifiedLineIdentity> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await this.request(
        "https://api.line.me/oauth2/v2.1/verify",
        {
          method: "POST",
          redirect: "error",
          credentials: "omit",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            id_token: idToken,
            client_id: this.channelId,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("invalid LINE token");
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > 65_536)
        throw new Error("invalid LINE token");
      if (!response.body) throw new Error("invalid LINE token");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 65_536) {
          await reader.cancel();
          throw new Error("invalid LINE token");
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const body = JSON.parse(new TextDecoder().decode(bytes)) as Record<
        string,
        unknown
      >;
      if (
        typeof body.sub !== "string" ||
        !body.sub.trim() ||
        body.sub.length > 256 ||
        body.aud !== this.channelId ||
        body.iss !== "https://access.line.me" ||
        typeof body.exp !== "number" ||
        !Number.isSafeInteger(body.exp) ||
        body.exp <= 0 ||
        body.exp * 1000 <= Date.now()
      ) {
        throw new Error("invalid LINE token");
      }
      return { sub: body.sub };
    } finally {
      clearTimeout(timer);
    }
  }
}
