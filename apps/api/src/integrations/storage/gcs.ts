import { PdfStorageError, type PdfStore } from "./pdf-store.js";

export { PdfStorageError } from "./pdf-store.js";

export type GcsPdfStoreOptions = {
  bucket: string;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

type Credentials = { token: string; refreshAt: number };
const metadataUrl =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

// Real GCS/IAM and Cloud Run metadata behavior still require external verification.
export class GcsPdfStore implements PdfStore {
  private readonly bucket: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private credentials: Credentials | undefined;
  private credentialRequest: Promise<Credentials> | undefined;

  constructor(options: GcsPdfStoreOptions) {
    this.bucket = encodeURIComponent(options.bucket);
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async put(objectKey: string, bytes: Uint8Array): Promise<void> {
    const query = new URLSearchParams({
      uploadType: "media",
      name: objectKey,
      ifGenerationMatch: "0",
    });
    const token = await this.accessToken();
    const alreadyExists = await this.request(
      `https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?${query}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/pdf",
        },
        body: new Uint8Array(bytes),
      },
      async (response) => {
        if (response.status === 412) {
          await response.body?.cancel();
          return true;
        }
        this.checkStorageResponse(response, token);
        await response.body?.cancel();
        return false;
      },
    );
    if (alreadyExists) {
      const existing = await this.get(objectKey);
      if (
        existing.length !== bytes.length ||
        !existing.every((value, index) => value === bytes[index])
      )
        throw new PdfStorageError("pdf_storage_object_conflict");
    }
  }

  async get(objectKey: string): Promise<Uint8Array> {
    const token = await this.accessToken();
    return this.request(
      `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(objectKey)}?alt=media`,
      { method: "GET", headers: { authorization: `Bearer ${token}` } },
      async (response) => {
        this.checkStorageResponse(response, token);
        return new Uint8Array(await response.arrayBuffer());
      },
    );
  }

  private checkStorageResponse(response: Response, token: string): void {
    if (response.status === 401 && this.credentials?.token === token) {
      this.credentials = undefined;
    }
    if (response.status === 404)
      throw new PdfStorageError("pdf_storage_not_found");
    if (!response.ok) throw new PdfStorageError("pdf_storage_http_error");
  }

  private async accessToken(): Promise<string> {
    if (this.credentials && this.now() < this.credentials.refreshAt)
      return this.credentials.token;
    if (!this.credentialRequest) {
      this.credentialRequest = this.loadCredentials();
    }
    const pending = this.credentialRequest;
    try {
      const credentials = await pending;
      this.credentials = credentials;
      return credentials.token;
    } finally {
      if (this.credentialRequest === pending)
        this.credentialRequest = undefined;
    }
  }

  private async loadCredentials(): Promise<Credentials> {
    // Start the lifetime clock before the request, never after network latency.
    const requestedAt = this.now();
    return this.request(
      metadataUrl,
      { headers: { "Metadata-Flavor": "Google" } },
      async (response) => {
        if (!response.ok)
          throw new PdfStorageError("pdf_storage_credentials_error");
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new PdfStorageError("pdf_storage_credentials_error");
        }
        if (typeof payload !== "object" || payload === null)
          throw new PdfStorageError("pdf_storage_credentials_error");
        const data = payload as Record<string, unknown>;
        if (
          typeof data.access_token !== "string" ||
          !/^[A-Za-z0-9._~+/-]+=*$/.test(data.access_token) ||
          data.token_type !== "Bearer" ||
          typeof data.expires_in !== "number" ||
          !Number.isFinite(data.expires_in) ||
          data.expires_in <= 0
        )
          throw new PdfStorageError("pdf_storage_credentials_error");
        return {
          token: data.access_token,
          refreshAt: requestedAt + Math.max(0, data.expires_in - 60) * 1_000,
        };
      },
    );
  }

  private async request<T>(
    url: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        ...init,
        signal: controller.signal,
        redirect: "error",
      });
      return await consume(response);
    } catch (error) {
      if (error instanceof PdfStorageError) throw error;
      throw new PdfStorageError("pdf_storage_network_error");
    } finally {
      clearTimeout(timeout);
    }
  }
}
