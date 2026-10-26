drop index credit_expire_once;
create unique index credit_period_expire_once
  on credit_entries (period_id) where kind = 'expire' and request_id is null;
create unique index credit_request_expire_once
  on credit_entries (request_id) where kind = 'expire' and request_id is not null;

create unique index credit_release_once_per_request
  on credit_entries (request_id) where kind = 'release' and request_id is not null;
create unique index credit_consume_once_per_request
  on credit_entries (request_id) where kind = 'consume' and request_id is not null;
alter table service_requests
  add column actual_credits integer,
  add constraint service_requests_actual_minutes_nonnegative
    check (actual_minutes is null or actual_minutes >= 0),
  add constraint service_requests_actual_credits_nonnegative
    check (actual_credits is null or actual_credits >= 0),
  add constraint service_requests_done_requires_completion_facts
    check (status <> 'done' or (completed_on is not null and actual_minutes is not null and actual_credits is not null));
