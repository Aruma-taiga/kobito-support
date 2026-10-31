import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { PdfStorageError, type PdfStore } from "./pdf-store.js";

type Queryable = Pick<Pool, "query">;

export class PostgresPdfStore implements PdfStore {
  constructor(private readonly pool: Queryable) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    return PostgresPdfStore.putInTransaction(this.pool, key, bytes);
  }

  static async putInTransaction(
    client: Queryable,
    key: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const invoiceId = invoiceIdFromKey(key);
    const content = Buffer.from(bytes);
    const sha256 = createHash("sha256").update(content).digest("hex");
    try {
      const result = await client.query(
        `insert into invoice_documents (invoice_id, mime_type, sha256, content, storage_key)
         values ($1, 'application/pdf', $2, $3, null)
         on conflict (invoice_id) do nothing returning invoice_id`,
        [invoiceId, sha256, content],
      );
      if (result.rowCount === 1) return;
      const existing = await new PostgresPdfStore(client).get(key);
      if (!content.equals(existing))
        throw new PdfStorageError("pdf_storage_object_conflict");
    } catch (error) {
      if (error instanceof PdfStorageError) throw error;
      throw new PdfStorageError("pdf_storage_database_error");
    }
  }

  async get(key: string): Promise<Uint8Array> {
    const invoiceId = invoiceIdFromKey(key);
    try {
      const result = await this.pool.query<{
        content: Buffer | null;
        sha256: string;
      }>(
        "select content, sha256 from invoice_documents where invoice_id = $1",
        [invoiceId],
      );
      const row = result.rows[0];
      if (!row?.content) throw new PdfStorageError("pdf_storage_not_found");
      if (createHash("sha256").update(row.content).digest("hex") !== row.sha256)
        throw new PdfStorageError("pdf_storage_integrity_error");
      return new Uint8Array(row.content);
    } catch (error) {
      if (error instanceof PdfStorageError) throw error;
      throw new PdfStorageError("pdf_storage_database_error");
    }
  }
}

function invoiceIdFromKey(key: string): string {
  const match =
    /^invoices\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.pdf$/.exec(
      key,
    );
  if (!match?.[1]) throw new PdfStorageError("pdf_storage_invalid_key");
  return match[1];
}
