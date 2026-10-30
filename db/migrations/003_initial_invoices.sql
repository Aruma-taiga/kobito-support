alter table invoices add column billing_address_snapshot text;

create table invoice_documents (
  invoice_id uuid primary key references invoices(id),
  mime_type text not null check (mime_type = 'application/pdf'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content bytea not null check (octet_length(content) between 1 and 5242880),
  created_at timestamptz not null default now()
);

create unique index invoices_one_nonvoid_initial_per_contract
  on invoices (contract_id)
  where kind = 'initial' and status <> 'void';

create or replace function next_invoice_no(p_year integer, p_prefix text default 'KS') returns text
language plpgsql as $$
declare n integer;
begin
  insert into invoice_number_counters (year, last_no) values (p_year, 1)
  on conflict (year) do update set last_no = invoice_number_counters.last_no + 1
  returning last_no into n;
  return format('%s-%s-%s', p_prefix, p_year, lpad(n::text, greatest(5, length(n::text)), '0'));
end $$;
