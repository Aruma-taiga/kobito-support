create unique index credit_extra_once_per_invoice
  on credit_entries (invoice_id)
  where kind='extra' and invoice_id is not null;
