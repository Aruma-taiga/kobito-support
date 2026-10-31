import type { Pool } from "pg";
import type { RuntimeConfig } from "../../platform/config.js";
import { GcsPdfStore } from "./gcs.js";
import type { PdfStore } from "./pdf-store.js";
import { PostgresPdfStore } from "./postgres.js";

export function createPdfStore(config: RuntimeConfig, pool: Pool): PdfStore {
  if (config.pdfStorage !== "gcs") return new PostgresPdfStore(pool);
  if (!config.pdfBucket) throw new Error("PDF_BUCKET is required");
  return new GcsPdfStore({ bucket: config.pdfBucket });
}
