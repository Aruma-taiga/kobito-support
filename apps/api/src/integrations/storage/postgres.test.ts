import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresPdfStore } from "./postgres.js";

const id = "11111111-1111-1111-1111-111111111111";
const key = `invoices/${id}.pdf`;
const bytes = new Uint8Array([37, 80, 68, 70]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
function database() {
  const query = vi.fn();
  return { query, db: { query } as unknown as Pick<Pool, "query"> };
}

describe("PostgresPdfStore", () => {
  it("stores bytes and their hash without overwriting an existing invoice document", async () => {
    const { query, db } = database();
    query.mockResolvedValue({ rowCount: 1, rows: [{ invoice_id: id }] });
    await new PostgresPdfStore(db).put(key, bytes);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("on conflict (invoice_id) do nothing"),
      [id, sha256, Buffer.from(bytes)],
    );
  });

  it("uses a supplied transaction client without opening another connection", async () => {
    const { query, db } = database();
    query.mockResolvedValue({ rowCount: 1, rows: [{ invoice_id: id }] });
    await PostgresPdfStore.putInTransaction(db, key, bytes);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("accepts an identical duplicate without changing the existing record", async () => {
    const { query, db } = database();
    query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [{ content: Buffer.from(bytes), sha256 }],
      });
    await new PostgresPdfStore(db).put(key, bytes);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toContain("select content, sha256");
  });

  it("rejects a duplicate with different bytes", async () => {
    const { query, db } = database();
    const other = Buffer.from("other");
    query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            content: other,
            sha256: createHash("sha256").update(other).digest("hex"),
          },
        ],
      });
    await expect(new PostgresPdfStore(db).put(key, bytes)).rejects.toThrow(
      "pdf_storage_object_conflict",
    );
  });

  it("reads verified PDF bytes using the invoice UUID", async () => {
    const { query, db } = database();
    query.mockResolvedValue({
      rows: [{ content: Buffer.from(bytes), sha256 }],
    });
    expect(await new PostgresPdfStore(db).get(key)).toEqual(bytes);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("where invoice_id = $1"),
      [id],
    );
  });

  it.each([
    { rows: [] },
    { rows: [{ content: null, sha256 }] },
  ])("rejects absent database content safely", async ({ rows }) => {
    const { query, db } = database();
    query.mockResolvedValue({ rows });
    await expect(new PostgresPdfStore(db).get(key)).rejects.toThrow(
      "pdf_storage_not_found",
    );
  });

  it("rejects hash-corrupted content", async () => {
    const { query, db } = database();
    query.mockResolvedValue({
      rows: [{ content: Buffer.from("different"), sha256 }],
    });
    await expect(new PostgresPdfStore(db).get(key)).rejects.toThrow(
      "pdf_storage_integrity_error",
    );
  });

  it.each([
    "other/a.pdf",
    "invoices/no-uuid.pdf",
    `${key}/more`,
  ])("rejects unsupported keys before querying", async (invalidKey) => {
    const { query, db } = database();
    const store = new PostgresPdfStore(db);
    await expect(store.get(invalidKey)).rejects.toThrow(
      "pdf_storage_invalid_key",
    );
    await expect(store.put(invalidKey, bytes)).rejects.toThrow(
      "pdf_storage_invalid_key",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("does not expose raw database errors", async () => {
    const { query, db } = database();
    query.mockRejectedValue(new Error("private SQL and invoice"));
    await expect(new PostgresPdfStore(db).get(key)).rejects.toThrow(
      "pdf_storage_database_error",
    );
  });
});
