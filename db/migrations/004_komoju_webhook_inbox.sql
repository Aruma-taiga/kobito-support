alter table komoju_events
  add column fingerprint text,
  add column collision_detected_at timestamptz,
  add column collision_count integer not null default 0 check (collision_count >= 0);
