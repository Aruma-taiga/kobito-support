-- Keep application API retries stable without retaining provider passwords or request bodies.
alter table applications
  add column disclosure_version text not null;

create table application_submission_keys (
  request_key   uuid primary key,
  auth_user_id  text not null references user_accounts(auth_user_id),
  application_id uuid not null unique references applications(id),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at    timestamptz not null default now()
);

-- A verified account may have at most one application awaiting review.
create unique index contracts_one_under_review_per_customer_idx
  on contracts (customer_id)
  where status = 'under_review';
