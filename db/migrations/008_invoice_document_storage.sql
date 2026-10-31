alter table invoice_documents alter column content drop not null;

alter table invoice_documents
  add column storage_key text;

alter table invoice_documents
  add constraint invoice_documents_one_location
  check ((content is not null) <> (storage_key is not null));
