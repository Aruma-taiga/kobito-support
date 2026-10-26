create unique index credit_reserve_once_per_request
  on credit_entries (request_id) where kind = 'reserve';

create table request_command_keys (
  request_key uuid primary key,
  actor text not null,
  command text not null check (command in ('create','estimate')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  target_id uuid not null,
  created_at timestamptz not null default now()
);
