-- コビトサポート基幹システム テーブル定義 v1（提案、2026-10-23、10-25 見積を別表に）
-- 対象：Cloud SQL for PostgreSQL 16（GCP、2026-10-25に変更）。説明は system-design-v1.md の6章。
-- お金は円の整数。日時は timestamptz、日付は Asia/Tokyo の date。

create extension if not exists pgcrypto;

-- ===== 設定（G-01：サービス名などを1か所で差し替え） =====
create table settings (
  key         text primary key,           -- service_name, company_name, invoice_registration_no, bank_account, konbini_fee_yen, ...
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ===== プラン（料金改定に備えて履歴で持つ） =====
create table plans (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,               -- light / standard / premium / custom（個別見積り）
  name          text not null,
  price_excl_tax integer,                    -- 税抜：5000 / 10000 / 15000。個別見積りは空（plan_quotes で決める）。2026-10-26 に税別表示へ
  credits       integer,                     -- 1 / 3 / 5。個別見積りは空
  is_custom     boolean not null default false,
  valid_from    date not null,
  valid_to      date,
  unique (code, valid_from),
  check (is_custom or (price_excl_tax is not null and credits is not null))
);

-- ===== パートナー =====
create table partners (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text,
  referral_code text not null unique,
  reward_type   text not null check (reward_type in ('appointment','closing')), -- アポ10% / 成約20%
  reward_rate   numeric(4,3) not null,       -- 0.100 / 0.200
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ===== 顧客 =====
create table customers (
  id                 uuid primary key default gen_random_uuid(),
  shop_name          text not null,          -- F-01
  contact_name       text not null,          -- F-02
  billing_name       text not null,          -- F-03
  billing_address    text not null,
  email              text not null,          -- F-04
  phone              text,                   -- F-05
  line_display_name  text,                   -- F-06
  line_user_id       text unique,            -- F-13（連携時）
  invoice_reg_no     text,                   -- F-09
  marketing_opt_in   boolean not null default false, -- C-03
  deletion_due_on    date,                   -- 解約・失効・承諾しないから1年（END-06）
  anonymized_at      timestamptz,
  created_at         timestamptz not null default now()
);

create table user_accounts (
  auth_user_id  text primary key,            -- Identity Platform の uid
  customer_id   uuid references customers(id),
  role          text not null check (role in ('customer','admin')),
  created_at    timestamptz not null default now()
);

-- ===== 見込み（KPI：アポ・商談） =====
create table leads (
  id             uuid primary key default gen_random_uuid(),
  shop_name      text not null,
  source         text not null check (source in ('partner','lp','direct','other')),
  partner_id     uuid references partners(id),
  appointment_on date,
  meeting_on     date,
  result         text check (result in ('open','applied','declined','lost')) default 'open',
  customer_id    uuid references customers(id),
  note           text,
  created_at     timestamptz not null default now()
);

-- ===== 申込み（同意の証拠：R-01〜R-05） =====
create table applications (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references customers(id),
  plan_id              uuid not null references plans(id),
  payment_method       text not null check (payment_method in ('card','konbini','bank_transfer')),
  referral_code        text,                 -- F-10
  partner_id           uuid references partners(id),
  free_text            text,                 -- F-11
  submitted_at         timestamptz not null default now(), -- R-01
  terms_version        text not null,        -- R-02
  privacy_version      text not null,
  consent_business_use boolean not null,     -- C-01
  consent_terms        boolean not null,     -- C-02
  consent_marketing    boolean not null,     -- C-03
  consent_partner_share boolean,             -- C-04
  shown_terms          jsonb not null,       -- R-05：最終確認で表示した料金・条件
  ip_address           inet,
  user_agent           text,
  reviewed_at          timestamptz,
  review_result        text check (review_result in ('approved','declined')), -- 審査完了・請求書を送る／承諾しない
  rejection_note       text
);

-- ===== 契約 =====
create table contracts (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references customers(id),
  application_id      uuid not null unique references applications(id),
  plan_id             uuid not null references plans(id),
  payment_method      text not null check (payment_method in ('card','konbini','bank_transfer')),
  status              text not null default 'under_review'
                      check (status in ('under_review','quoting','awaiting_quote_approval','awaiting_payment','active','cancel_scheduled','ended','declined','lapsed')), -- 審査待ち／見積り作成中／見積り了承待ち／入金待ち／利用中／解約予定／終了／承諾しない／失効
  anchor_date         date,                  -- 契約日（初月の入金確認日）＝期間の起点
  first_invoice_due_on date,                 -- 初月請求の期限（発行から7日）
  cancel_requested_at timestamptz,
  ends_on             date,                  -- 解約予定の期間の最終日
  ended_at            timestamptz,
  komoju_subscription_id text,               -- カードのみ。カード情報は持たない
  next_plan_id        uuid references plans(id), -- 次の期間からのプラン変更
  plan_quote_id       uuid,                  -- 個別見積り：了承した見積りの版
  welcome_shown_at    timestamptz,           -- 契約開始のお知らせ（c05）を見た日時。空なら次のログインで表示
  created_at          timestamptz not null default now()
);

-- ===== 個別見積りのプランの見積り（3.5章） =====
create table plan_quotes (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references contracts(id),
  version         integer not null,
  price_excl_tax  integer not null check (price_excl_tax > 0), -- 月額（税抜）
  credits         integer not null check (credits > 0),
  description     text not null,
  expires_on      date not null,             -- 案：送ってから14日
  sent_at         timestamptz,
  approved_at     timestamptz,
  approved_by     text,                      -- 了承した人の uid
  superseded_at   timestamptz,
  unique (contract_id, version)
);
alter table contracts
  add constraint contracts_plan_quote_fk foreign key (plan_quote_id) references plan_quotes(id);
create index on contracts (status);

-- ===== 期間（契約日起点の1か月） =====
create table billing_periods (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references contracts(id),
  seq          integer not null,             -- 1, 2, 3 ...
  starts_on    date not null,
  ends_on      date not null,                -- 次の期間の始まりの前日
  plan_id      uuid not null references plans(id),
  price_excl_tax integer not null,          -- この期間の月額（税抜）の写し（固定プラン・個別見積りの両方）
  credits      integer not null,             -- この期間に付与するクレジット数の写し
  unique (contract_id, seq)
);

-- ===== 請求 =====
create table invoice_number_counters (
  year      integer primary key,
  last_no   integer not null default 0
);

create table invoices (
  id               uuid primary key default gen_random_uuid(),
  invoice_no       text not null unique,     -- KS-2026-00001（INV-04）
  contract_id      uuid not null references contracts(id),
  period_id        uuid references billing_periods(id), -- 月額の請求のみ
  kind             text not null check (kind in ('initial','monthly','extra_credit')),
  status           text not null default 'issued'
                   check (status in ('issued','paid','failed','overdue','void')),
  payment_method   text not null check (payment_method in ('card','konbini','bank_transfer')),
  issued_on        date not null,
  due_on           date,
  total_excl_tax   integer not null,         -- 税抜の小計（明細の合計）
  tax_amount       integer not null,         -- 消費税＝税抜の小計×10%の端数を切り捨て（請求書ごと・税率ごとに1回）
  total_incl_tax   integer not null,         -- 税込合計＝小計＋消費税。お客様が払う額
  check (total_incl_tax = total_excl_tax + tax_amount),
  billing_name     text not null,            -- 発行時点の宛名の写し
  issuer_snapshot  jsonb not null,           -- 当社名・登録番号・振込先の写し（INV-02）
  komoju_payment_id text,                    -- コンビニ・追加C
  konbini_payment_info jsonb,                -- 支払番号・期限
  card_payment_url text,                     -- 初月カード：定期課金の支払い画面
  pdf_path         text,
  voided_at        timestamptz,
  void_reason      text,
  replaced_by      uuid references invoices(id),
  created_at       timestamptz not null default now(),
  unique (period_id, kind)                   -- 同じ期間に月額請求を二重に作らない
);
create index on invoices (status, due_on);

create table invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references invoices(id),
  line_kind     text not null check (line_kind in ('monthly_fee','extra_credit','konbini_fee')),
  description   text not null,
  quantity      integer not null default 1,
  unit_price_excl_tax integer not null,      -- 税抜
  amount_excl_tax integer not null,          -- 税抜（単価×数量）
  tax_rate      numeric(4,3) not null default 0.100
);

create table payments (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references invoices(id),
  method          text not null check (method in ('card','konbini','bank_transfer')),
  amount          integer not null,          -- 税込合計（実際に払われた額）
  paid_on         date not null,
  confirmed_via   text not null check (confirmed_via in ('webhook','manual')),
  komoju_payment_id text unique,
  confirmed_by    text,                      -- 手動のとき：管理者の uid
  created_at      timestamptz not null default now()
);

-- ===== 依頼 =====
create table service_requests (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references contracts(id),
  received_on     date not null,
  summary         text not null,
  urgent          boolean not null default false,
  status          text not null default 'received'
                  check (status in ('received','awaiting_approval','in_progress','done','withdrawn')),
  approved_estimate_id uuid,                 -- 了承した見積の版（estimates.id）
  completed_on    date,
  actual_minutes  integer,
  created_at      timestamptz not null default now()
);

-- 見積（送信後は書き換えず、出し直しは新しい版。MY-06）
create table estimates (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references service_requests(id),
  version         integer not null,
  credits         integer not null check (credits > 0),
  due_on          date not null,             -- 目安日
  work_items      jsonb not null check (jsonb_typeof(work_items) = 'array' and jsonb_array_length(work_items) > 0), -- 作業内容（箇条書き・必須）
  done_criteria   text not null,             -- 完了の状態（必須）
  exclusions      text,                      -- 含まれないもの
  customer_prep   text,                      -- お客様にご用意いただくもの
  sent_at         timestamptz,
  approved_at     timestamptz,
  approved_by     text,                      -- 了承した人の uid
  superseded_at   timestamptz,               -- 新しい版を出したとき
  unique (request_id, version)
);
alter table service_requests
  add constraint service_requests_approved_estimate_fk foreign key (approved_estimate_id) references estimates(id);

-- ===== クレジット（1行＝1回の動き） =====
create table credit_entries (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references contracts(id),
  period_id    uuid not null references billing_periods(id),
  kind         text not null check (kind in ('grant','extra','reserve','release','consume','expire')),
  amount       integer not null,             -- 付与・追加・予約取消は＋、予約・消費・失効は−。完了時は「予約取消＋見積C」と「消費−実績C」を同時に入れる
  request_id   uuid references service_requests(id),
  invoice_id   uuid references invoices(id),
  occurred_at  timestamptz not null default now(),
  note         text
);
create unique index credit_grant_once on credit_entries (period_id) where kind = 'grant';
create unique index credit_expire_once on credit_entries (period_id) where kind = 'expire';

-- 期間ごとの残り（付与＋追加−予約＋予約取消−失効）
create view credit_balances as
select period_id, contract_id, sum(amount) as balance
from credit_entries group by period_id, contract_id;

-- ===== 紹介・報酬 =====
create table referrals (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references partners(id),
  contract_id  uuid not null unique references contracts(id),
  reward_type  text not null check (reward_type in ('appointment','closing')),
  reward_rate  numeric(4,3) not null,        -- 申込み時点の率の写し
  max_months   integer not null default 12,  -- 暫定
  created_at   timestamptz not null default now()
);

create table partner_rewards (
  id            uuid primary key default gen_random_uuid(),
  referral_id   uuid not null references referrals(id),
  payment_id    uuid not null unique references payments(id),
  target_month  date not null,               -- 入金のあった月（1日で持つ）
  month_index   integer not null,            -- 1〜max_months
  base_amount   integer not null,            -- 月額基本料（表示価格・税抜）。追加C・コンビニ手数料は含めない
  reward_amount integer not null,
  paid_on       date
);

-- ===== 通知 =====
create table notifications (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid references customers(id),
  kind          text not null,               -- NT-01 ... NT-08
  channel       text not null check (channel in ('email','line')),
  dedupe_key    text not null unique,        -- 例：NT-05:invoice_id:day1:line
  scheduled_at  timestamptz not null,
  sent_at       timestamptz,
  attempts      integer not null default 0,
  last_error    text,
  payload       jsonb not null default '{}'
);
create index on notifications (sent_at, scheduled_at);

-- ===== KOMOJU Webhook =====
create table komoju_events (
  id            text primary key,            -- KOMOJUのイベントID（同じものは無視）
  type          text not null,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);

-- ===== 操作の記録 =====
create table audit_logs (
  id          bigserial primary key,
  actor       text,                          -- 操作した人の uid
  action      text not null,
  target_type text,
  target_id   text,
  detail      jsonb,
  at          timestamptz not null default now()
);

-- ===== 請求番号の採番（欠番・重複なし） =====
create or replace function next_invoice_no(p_year integer, p_prefix text default 'KS') returns text
language plpgsql as $$
declare n integer;
begin
  insert into invoice_number_counters (year, last_no) values (p_year, 1)
  on conflict (year) do update set last_no = invoice_number_counters.last_no + 1
  returning last_no into n;
  return format('%s-%s-%s', p_prefix, p_year, lpad(n::text, 5, '0'));
end $$;

-- 閲覧制限は Cloud Run の API 側で、ログインした人の customer_id で全ての読み書きを絞る（管理者のみ全件）。
-- データベースには API 以外からつながない（Cloud SQL の接続は Cloud Run のサービスアカウントのみ）。
