-- Preserve the original inclusive catalog as a historical version, then
-- publish the approved inclusive prices from 2026-10-31.
insert into plans (code, name, price_incl_tax, credits, is_custom, valid_from)
values
  ('light', 'ライト', 5000, 1, false, date '2026-10-25'),
  ('standard', 'スタンダード', 10000, 3, false, date '2026-10-25'),
  ('premium', 'プレミアム', 15000, 5, false, date '2026-10-25')
on conflict (code, valid_from) do nothing;

update plans
   set valid_to = date '2026-10-30'
 where code in ('light', 'standard', 'premium')
   and valid_from < date '2026-10-31'
   and (valid_to is null or valid_to >= date '2026-10-31');

insert into plans (code, name, price_incl_tax, credits, is_custom, valid_from)
values
  ('light', 'ライト', 5500, 1, false, date '2026-10-31'),
  ('standard', 'スタンダード', 11000, 3, false, date '2026-10-31'),
  ('premium', 'プレミアム', 16500, 5, false, date '2026-10-31')
on conflict (code, valid_from) do nothing;
