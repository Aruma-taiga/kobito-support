export interface PdfStore {
  put(objectKey: string, bytes: Uint8Array): Promise<void>;
  get(objectKey: string): Promise<Uint8Array>;
}

export type StorageErrorReason =
  | "pdf_storage_credentials_error"
  | "pdf_storage_http_error"
  | "pdf_storage_not_found"
  | "pdf_storage_object_conflict"
  | "pdf_storage_network_error"
  | "pdf_storage_invalid_key"
  | "pdf_storage_integrity_error"
  | "pdf_storage_database_error";

export class PdfStorageError extends Error {
  constructor(readonly reason: StorageErrorReason) {
    super(reason);
    this.name = "PdfStorageError";
  }
}
