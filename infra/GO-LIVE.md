# 本番切替の手順書（チェックリスト）

この文書は、リポジトリの現状（`infra/terraform/`、`apps/api/`、`apps/web/`、`db/`、`docs/`）を読んで書いた手順書です。**実際に本番へ適用したことはありません。** 読んで確認できなかった点は「未確認」、コードと文書が食い違っていた点は「食い違い」と明記しています。秘密の値・実在の ID・本物のドメインは書いていません（`<…>` は置き換える場所です）。

凡例：**[O]** = オーナー（あなた）が行う。**[D]** = 開発側が行える（コード修正・手順の準備）。**[O/D]** = 画面操作はオーナー、コマンドの用意は開発側、など。

---

## 0. 先に知っておくべき要点（読んで初めて分かったこと）

本番の前に直すか決める必要があるものを先頭に並べます。詳細は各章へ。

| # | 内容 | 種別 | 詳細 |
|---|---|---|---|
| 1 | （解消済み）Cloud Run Jobs（`daily` / `notifications` / `retention`）に `WEB_ORIGIN` が渡されていなかった。`config.ts` は `WEB_ORIGIN` を必須にしており、そのままでは Job が起動時に失敗する。**`main.tf` で 3 本に API と同じ `https://app.${var.domain_name}` を渡すよう修正した。** `config.ts` の必須変数は `DATABASE_URL`・`FIREBASE_PROJECT_ID`・`WEB_ORIGIN` の 3 つで、他に不足はない | 修正済み（`terraform validate` と実機の手動実行での確認は未） | 7章 |
| 2 | `DATABASE_URL` を空ホスト形式（`postgresql://user:pw@/db?host=/cloudsql/…`）で書くと、`config.ts` の `.url()` 検証で**拒否される**。`postgresql://user:pw@localhost/db?host=/cloudsql/<接続名>` の形は `loadConfig` を通り、`pg` が `host` をソケットのディレクトリ（`/cloudsql/<接続名>`）、`localhost` を無視して解釈することをこのリポジトリの `pg` で確認した（Cloud SQL への実接続は未検証）。Terraform README の例も直した | 修正済み | 4章 |
| 3 | DB マイグレーションと seed は `tsx` を使う手元実行用で、**本番コンテナには入っていない**（Dockerfile は `pnpm deploy --prod` で `db/` も含めない）。本番では手元から Cloud SQL Auth Proxy 経由で実行する形になる | 実装を読んだ結果。**本番での実行方法は別PRで対応中（この手順書では書き換えない）** | 4章 |
| 4 | **seed は本番でも必須。** `plans`（料金プラン）は seed 以外で入らない。`settings` の初期キーも seed が作る | 設計書・README に明記なし。**本番での seed の実行方法は別PRで対応中** | 4章 |
| 5 | 発行者情報（会社名・住所・登録番号・振込先）の**実際の取得元は `settings` テーブル**。環境変数 `INVOICE_REGISTRATION_NO` / `BANK_*` / `COMPANY_NAME` / `SERVICE_NAME` は `config.ts` が読み込むが、請求書の発行処理は使っていない（`invoices/repository.ts` は `settings` だけを読む）。Terraform の `company_name` / `service_name` 変数も請求書には効かない | `.env.example` / Terraform とコードの食い違い | 2章 |
| 6 | 請求書を本番で発行できる条件は、`settings` に **全項目**（サービス名・会社名・住所・`T`+13桁の登録番号・接頭辞・振込先5項目）が入っていること。1つでも欠けると発行不可（`issuer_not_configured`） | コードで確認 | 2章 |
| 7 | **本番の管理者アカウントを作る手順がリポジトリにない。** `seed:dev-admin` はローカルのエミュレータ専用でガードされている。管理者には、Firebase のユーザー作成、**TOTP の登録**、DB の `user_accounts` への `admin` 行の追加が必要。Web には TOTP の**登録**画面がなく（ログイン時の確認コード入力だけ）、登録手段は未整備 | 未実装（[D] 要対応）。**本番の管理者アカウントの作成と TOTP の登録は別PRで対応中（この手順書では書き換えない）** | 3章 |
| 8 | （解消済み）`scheduler_paused` が 3 つの Scheduler 全部に効いていた。**`retention_scheduler_paused`（既定 `true`）を追加し、`scheduler_paused` は `daily`・`notifications` のみに効くようにした。** 匿名化は dry-run 確認と承認が済むまで別に止めておける | 修正済み | 8章 |
| 9 | 顧客のパスワード再設定は `sendPasswordResetEmail(auth, email)` を**追加設定なし**で呼ぶだけ。遷移先 URL の指定（ActionCodeSettings）はない。アプリ側に再設定用の画面（`oobCode` の処理）もないため、Firebase 既定の再設定ページが使われる見込み（Firebase の一般仕様に基づく推定。実環境は未確認）。**管理者ログインには再設定機能がない** | コード確認 | 3章 |
| 10 | `contact_email`（S-03 の当社あて通知の宛先、通知メールのフッターのお問い合わせ先）は seed が既定値を入れ、**管理画面の発行者設定では編集できない**（編集できる 6 キーに含まれない）。変更は SQL で行う。既定値のドメインは設計書で綴り確認待ちのもの | コード確認 | 2章 |
| 11 | `api.<ドメイン>` は Terraform が Cloud Run の URL への CNAME として作るが、**Cloud Run のドメインマッピング（またはロードバランサ）のリソースがない。** 設計書は「Cloud Run のカスタムドメインにつなぐ」としている。この CNAME だけで `https://api.<ドメイン>` が動くかは未確認 | 未確認。[D] 要検証 | 4章 |
| 12 | Terraform の Cloudflare Pages は Git 連携先が `YOUR_GITHUB_ACCOUNT` / `YOUR_REPOSITORY` のままで、デプロイ無効。一方 `apps/web/wrangler.toml` は Workers の静的アセット配信の設定。**Pages と Workers のどちらで出すかが未決** | 食い違い。[O/D] 要判断 | 4章 |
| 13 | （解消済み）文書の古い記述（`webhooks/README.md`、`integrations/README.md`、`jobs/README.md`、`docs/implementation-status.md`）を、コードの現状に合わせて更新した | 修正済み | 10.3 |

---

## 1. 全体の流れ

順序は上から。各段階が終わるまで次へ進みません。**カードと定時処理は最後まで無効のまま**進めます。

| 段階 | 内容 | 担当 | 章 |
|---|---|---|---|
| A | 事前準備：GCP・Cloudflare・ドメイン・KOMOJU 審査・Resend・会社情報 | **[O]** が中心 | 2 |
| B | Firebase Authentication（Identity Platform）の設定・パスワード再設定・管理者 2 段階認証 | **[O]** 画面操作、**[D]** 管理者登録手段の用意 | 3 |
| C | Terraform の段階適用・シークレット登録・イメージのビルド・マイグレーション・seed | **[O/D]**（権限のある人がコマンドを実行） | 4 |
| D | 発行者情報の入力（管理画面 `/admin/settings`） | **[O]** | 2 |
| E | 通し確認（テストモードの KOMOJU・メールを有効にして 1 件通す） | **[O/D]** | 6 |
| F | カードを有効にする前の確認と KOMOJU の本番 Webhook 登録 | **[O]** | 5 |
| G | 定時処理（Scheduler）の起動 | **[O/D]** | 8 |
| H | 切替当日、戻し方、障害時の見る場所、既知の未実装 | **[O/D]** | 9・10 |

| 開発側（[D]）が行えること | オーナー（[O]）にしかできないこと |
|---|---|
| Terraform のコード修正、`terraform fmt` / `validate` / `plan` の確認 | 各サービスの契約・課金・本人確認・審査（GCP、Cloudflare、KOMOJU、Resend） |
| Job の `WEB_ORIGIN` 不足などコードと設定の食い違いの修正（`WEB_ORIGIN` と `retention_scheduler_paused` は修正済み） | ドメインの綴りの確定と DNS の管理権限 |
| 管理者の TOTP 登録手段・本番用の管理者登録手順の整備 | 会社名・住所・インボイス登録番号・振込先の確定と入力 |
| コマンド列・確認用 SQL の用意 | KOMOJU 本番キー・Webhook の秘密値の発行（値は人が Secret Manager に入れる） |
| 通し確認の自動テスト（`apps/api/src/e2e/rehearsal.db.test.ts` はローカル DB 用で、本番の代わりにはならない） | `komoju_enabled` / `mail_enabled` / `scheduler_paused` を切り替える最終判断 |

---

## 2. 事前準備（人が行う）[O]

- [ ] **GCP プロジェクトを作り、請求先を関連付ける。** Cloud SQL・Cloud Run・Scheduler・Identity Platform の利用条件と予算アラートを確認する（`infra/terraform/README.md`）。
- [ ] **Cloudflare のアカウントと Zone を用意し、API トークンを発行する。** Pages と DNS に必要な範囲だけにする。値は `terraform.tfvars` に書かず、環境変数（`TF_VAR_cloudflare_api_token`）等で渡す。
- [ ] **ドメインの正式な綴りを確認する。** 設計書・seed には `cingulata.jp` が出てくるが、確認待ちの扱い（Terraform README も「決め打ちしていない」）。確定するまで `terraform.tfvars` の `domain_name` と `mail_from_domain` を埋めない。画面は `app.<ドメイン>`、API は `api.<ドメイン>`（Terraform の `WEB_ORIGIN` と `VITE_API_BASE_URL` がこの前提）。
- [ ] **KOMOJU の加盟店の本番審査を通す。** カードの取り扱いには審査があり日数がかかる（`implementation-plan-v1.md`）。
- [ ] **KOMOJU の加盟店名（ホスト画面に表示される名称）を当社の名称に変更する。** W1 の確認で、テスト環境のホスト画面には別名が表示されていた（`docs/implementation-status.md`）。本番審査後、本番の設定でも表示名を確認する。
- [ ] **Resend のアカウントを作り、送信ドメインを追加する。** 表示された SPF・DKIM を DNS に設定し、Resend 側で「検証済み」になるまで待つ（`integrations/mail/README.md`）。Terraform では `resend_spf_value` / `resend_dkim_name` / `resend_dkim_value` / `mail_from_domain` として渡し、Cloudflare の DNS に TXT レコードを作る。
  - 注意：Terraform の SPF レコードは `mail_from_domain` の名前に TXT を作る。ドメインに既に SPF の TXT がある場合は重複しないよう確認する（未確認。実際の DNS の状態による）。
  - `MAIL_FROM` は検証済みドメインのアドレス。表示名つきなら `サービス名 <info@example.invalid>` の形（`config.ts` は `名前 <a@b.c>` か `a@b.c` のみ許可）。
- [ ] **会社情報・インボイス登録番号・振込先を確定する。**

### 発行者情報の入れ方（`settings` テーブル。環境変数ではない）

| 項目 | 入れる場所 | 備考 |
|---|---|---|
| サービス名、会社名、会社住所、インボイス登録番号、請求番号の接頭辞、振込先（銀行名・支店名・口座種別・口座番号・口座名義） | **管理画面 `/admin/settings`**（管理者 + 2 段階認証が必須）。`settings` の `service_name` / `company_name` / `company_address` / `invoice_registration_no` / `invoice_prefix` / `bank_account` を更新し、操作を `audit_logs` に残す | 実行時の正本は `settings`（`modules/issuer-settings`、`modules/invoices/repository.ts`） |
| 上記と同名の環境変数（`SERVICE_NAME`、`COMPANY_NAME`、`INVOICE_PREFIX`、`INVOICE_REGISTRATION_NO`、`BANK_ACCOUNT_*`） | 入れても請求書には使われない | 食い違い。`.env.example` と Terraform（`company_name`、`service_name`、`invoice_prefix` の変数）に残っているが、請求書の発行はこれらを読まない。Terraform の変数は空のままでよい（[D] は整理を検討） |
| お問い合わせメール（`contact_email`）、`konbini_fee_yen` | `settings`。seed が `contact_email` に既定値を入れる | **管理画面では編集できない。** S-03（当社あての受付通知）の宛先と通知メールのフッターに使われる。ドメインが確定したら SQL で更新する（下記） |

- [ ] 管理画面で上記の全項目を入力する。**インボイス登録番号は `T` + 13 桁**の形式でなければ「発行可能」と判定されない（`^T\d{13}$`）。空欄のままだと請求書の発行（審査完了）ができない。
- [ ] `/admin/settings` の「発行可能」表示が出ることを確認する（API は `issuanceReady` を返す）。
- [ ] `contact_email` を確定したアドレスに更新する（[D] が SQL を用意、[O] が承認）。例：`update settings set value = to_jsonb('<確定したアドレス>'::text), updated_at = now() where key = 'contact_email';`（SQL は未実行・未検証）
- [ ] `invoice_preview_enabled` が `settings` に無い、または `true` でないことを確認する。本番では環境変数 `DEV_INVOICE_PREVIEW=1` も、プレビュー発行も許可されない（`config.ts` が拒否）。
- [ ] 公開法務文書（利用規約・プライバシーポリシー・特商法）の URL・版は `.env.example` に `LEGAL_*` の項目があるが、**読んでいるコードはローカル用の `apps/api/scripts/seed-dev-auth.ts` だけ**。本番での設定先は未確認（`docs/implementation-status.md` も「確定が必要」と記載）。[D] が確認する。

---

## 3. Firebase Authentication（Identity Platform）の設定

Terraform が行うのは `identitytoolkit.googleapis.com` の API 有効化だけで、**テナント・ログイン方式・MFA は設定されない**（Terraform README 7 項）。

### 3.1 基本設定 [O]

- [ ] Identity Platform を有効化する（Firebase/Identity Platform のプロジェクトを GCP プロジェクトに揃える）。設計書は「Identity Platform（Firebase Authentication の上位版）」を指定している。
- [ ] ログイン方法で**メール／パスワード**を有効にする（顧客は `createUserWithEmailAndPassword` で自分でアカウントを作る：`apps/web/src/auth/firebase-client.ts`）。
- [ ] 本番の画面ドメイン（`app.<ドメイン>`）を**承認済みドメイン**に追加する。
- [ ] Web アプリを登録し、API キー・`authDomain`・プロジェクト ID・アプリ ID を控える。Terraform の `web_firebase_*` 変数と、Web ビルドの `VITE_FIREBASE_*` に使う。`VITE_FIREBASE_PROJECT_ID` が `demo-` で始まる値や API キー `fake-api-key` は、本番ビルドで拒否される（`apps/web/src/platform/config.ts`）。
- [ ] API 側の `FIREBASE_PROJECT_ID` は Terraform が `gcp_project_id` の値を渡す。**Firebase のプロジェクト ID と GCP のプロジェクト ID が同じである前提**（別の場合は食い違う。[D] 確認）。
- [ ] 本番環境に `FIREBASE_AUTH_EMULATOR_HOST` が無いこと（あると API が起動しない）。

### 3.2 パスワード再設定メール（#32 で追加した機能）

コードの動き（`apps/web/src/pages/LoginPage.tsx`、`firebase-client.ts`）：

- ログイン画面の「再設定」からメールアドレスを入力すると `sendPasswordResetEmail(auth, email)` を**引数 2 つだけ**で呼ぶ。遷移先 URL（`continueUrl`）や `handleCodeInApp` は指定していない。
- 登録のないメールアドレスでも、利用者には「登録されている場合は送信しました」と表示する（`auth/user-not-found` は成功扱い）。
- 再設定リンクを開いた後の画面（`confirmPasswordReset` など）は**アプリ内に無い**。Firebase 既定の再設定ページを使う前提のコードになっている。
- 管理者のログイン画面（`AdminLoginPage.tsx`）には再設定の機能がない。

Firebase コンソール（Authentication → Templates → パスワードの再設定）で行う設定 [O]：

- [ ] **送信元（差出人名・メールアドレス）**を当社の名称にする。独自ドメインの送信元にするにはコンソールでドメインの検証（DNS）が必要。この DNS 設定は Resend の SPF/DKIM とは**別**。具体的な値はコンソールが表示する（未確認）。
- [ ] **件名・本文**を日本語にする（テンプレートの言語を日本語に設定。既定は英語）。
- [ ] **返信先（reply-to）**を `contact_email` と同じ窓口にするか決める。
- [ ] **アクション URL（再設定後の遷移先）**：コード側が遷移先を指定していないため、**テンプレートの既定（Firebase の再設定ページ）のまま**にするのが、現状のコードと整合する。独自ドメインの再設定ページに変えるなら、アプリ側に画面を作る必要がある（[D] 実装が必要。現状は未実装）。
- [ ] 本番の画面ドメインが承認済みドメインに入っていることを確認する（3.1）。
- [ ] 再設定メールを実際に 1 通受け取り、リンクから新しいパスワードを設定し、そのパスワードでログインできることを確認する（未確認）。
- [ ] ログイン画面の案内文（`loginForgotPassword`）などの文面が本番の窓口と一致するか確認する（`packages/shared/src/messages.ts`）。

### 3.3 管理者の 2 段階認証（TOTP）[O/D]

> **別PRで対応中：** 本番の管理者アカウントの作成と TOTP の登録は別のPRで整備している。この節の手順は、そのPRの内容が決まるまで書き換えない。


コードで確認した事実：

- 管理者の API は、ID トークンの `firebase.sign_in_second_factor` が空でない場合だけ通す（`apps/api/src/platform/auth.ts` の `requireAdmin`）。管理者向け API は ID トークンの失効も確認する（`checkRevoked = true`）。
- Web の管理者ログイン（`firebase-admin-client.ts`）は、本番（エミュレータなし）では**TOTP の確認コード（6 桁）だけ**を受け付け、電話（SMS）などその他の要素は「未対応」として拒否する。
- 画面は `getMultiFactorResolver` でログイン時の確認を行うのみ。**TOTP を新規に登録する（QR/シークレットを表示して登録する）画面やスクリプトは、リポジトリに無い。**

手順：

- [ ] [O] Identity Platform の設定で**多要素認証（MFA）を有効にし、TOTP を許可**する（コンソールの手順は未確認）。
- [ ] [O] 管理者になる Firebase ユーザー（メール＋パスワード）を作成する（コンソールまたは Admin SDK）。
- [ ] [D] **TOTP の登録手段を用意する**（例：一度だけ使う登録用の最小画面またはスクリプトで、クライアント SDK の MFA 登録 API を呼ぶ）。**現状は未整備。** 登録できないと本番の管理画面に入れない。
- [ ] [D/O] 管理者の uid を DB の `user_accounts` に `role = 'admin'`、`customer_id` なしで追加する（テーブル定義は `db/migrations/001_initial.sql`）。アカウントが見つからないと API は 401 を返す。SQL の例は 4.7 を参照（未実行・未検証）。
- [ ] 開発用のシード（`pnpm dev:seed-admin`、`DEV_ADMIN_*`、`admin:dev-code`）は**本番では使わない。** ローカルのエミュレータ専用で、本番相手にはガードで拒否される。
- [ ] 管理画面 `/admin/login` で、パスワード → TOTP コードの順でログインでき、2 段階認証なしでは `/admin` の API が 403 になることを確認する。
- [ ] 管理者アカウントのパスワードを失った場合の復旧手段を決めておく（管理者には再設定画面がない）。Firebase コンソール側での対応になる見込み（未確認）。
- [ ] 管理者は少なくとも 2 名か、復旧用の手順を決める（1 名だけだと TOTP の端末を失ったとき管理画面に入れない。設計書は「taiga さんだけ」。判断は [O]）。

---

## 4. Terraform の適用とアプリの配備

前提：Terraform CLI は作業環境になく、**`fmt` / `validate` / `plan` / `apply` はこのリポジトリで一度も実行していない**（Terraform README）。最初に [D] が `terraform fmt -check`、`validate` を行い、`plan` の差分を [O] が確認してから適用する。

### 4.1 変数

`infra/terraform/terraform.tfvars.example` を `terraform.tfvars` にコピーして埋める（ファイルは Git に入れない）。

| 変数 | 初期値 | 切り替える時期 |
|---|---|---|
| `scheduler_paused` | `true` | `daily` と `notifications` の Scheduler。8章：通し確認・各 Job の手動実行が済んでから `false` |
| `retention_scheduler_paused` | `true` | `retention`（匿名化）の Scheduler だけを止める。8.3 の dry-run 確認と保持期間・監査の承認が済むまで `true` のまま。`scheduler_paused` とは独立 |
| `komoju_enabled` | `false` | 5章：カードの確認事項を終え、Secret に版を登録した後。**true にするまでカード決済は無効** |
| `mail_enabled` | `false` | Resend のドメイン検証と Secret 登録の後（6章の通し確認の前） |
| `pdf_storage_gcs_enabled` | `false` | GCS 保存の実環境確認の後。**下の注意を参照** |
| `api_image` | プレースホルダ | イメージをビルドして登録した後に実際のタグを渡す |
| `database_password_secret_version` | `"1"` | DB パスワードの Secret にバージョンを入れた後 |
| `cloudflare_api_token` | 空 | 環境変数で渡す（ファイルに書かない） |

`pdf_storage_gcs_enabled` の注意：`PDF_STORAGE` が `gcs` でない場合、PDF は PostgreSQL に保存される。API の README は「本番では Cloud Storage のアダプターが必要」としている一方、コードは `postgres` 保存でも拒否しない（`createPdfStore` は `gcs` 以外なら Postgres に保存する）。**設計は Cloud Storage 前提なので、本番で請求書を発行する前に `pdf_storage_gcs_enabled = true` にして実環境で確認する**のが設計と合う。ただし GCS の実動作は未検証（10.1）。

### 4.2 適用の順序（`infra/terraform/README.md`「初回有効化の順序」と一致）

`README` の 6 段階を、実際のコマンドの単位に分けます。**段階適用（`-target`）の使い方は README に書かれていない補足で、未検証です。** 循環（Cloud Run がイメージと Secret の版を必要とし、それを置く先は Terraform が作る、など）があるため必要になる見込みです。

- [ ] **README 1**：GCP/Cloudflare、請求、権限、Identity Platform、Secret Manager の前提を整える（2・3章）。`gcloud auth application-default login` などで適用者の権限を用意する（権限の範囲は未確認）。
- [ ] **README 2**：DB パスワードの Secret を用意し、Cloud SQL と DB/User を作る。
  1. [D/O] API 有効化・Secret の枠だけを作る（例：`terraform apply -target=google_project_service.enabled -target=google_secret_manager_secret.database_password -target=google_artifact_registry_repository.api`）。
  2. [O] DB パスワードの値を Secret `<prefix>-database-password` にバージョンとして登録する（4.3 のコマンド）。そのバージョン番号を `database_password_secret_version` に入れる（`data` が版を読むため、版がないと `plan` 自体が失敗する）。
  3. [D/O] `terraform apply -target=google_sql_database_instance.main -target=google_sql_database.app -target=google_sql_user.app`。Cloud SQL は削除保護あり、`db-f1-micro`、自動バックアップと PITR 有効。
  4. [O] Terraform の state に DB パスワードが含まれうる。**GCS backend を有効化する前に state の保管先を厳格に保護**し、アクセス権を限定する（`versions.tf` の GCS backend はコメントアウトされている）。
- [ ] **マイグレーションと seed（4.5・4.6）**：README は「別途、承認済みの手順で実行」とだけ書いている。
- [ ] **README 3**：Artifact Registry に API イメージをビルド・登録し、`api_image` に渡す（4.4）。
- [ ] **README 4**：アプリ Secret の必要な版を登録（4.3）してから Cloud Run API を起動し、ヘルスチェック・認証・Webhook の疎通を確認する。
  - Cloud Run は版のない Secret を参照すると起動に失敗する。このため `DATABASE_URL` は必須。`KOMOJU_*` と `RESEND_API_KEY` / `MAIL_FROM` は、それぞれの有効化変数が false の間は Cloud Run に渡らない。
  - [ ] `GET <API の URL>/healthz` が `{"status":"ok"}` を返す。
  - [ ] **`api.<ドメイン>` の疎通を確認する**（上の要点 11。Terraform は CNAME を作るが、Cloud Run のドメインマッピングを作らない。動かない場合は [D] がドメインマッピングまたはロードバランサを追加する）。KOMOJU の Webhook はこの URL に届く。
  - [ ] 顧客用の API が ID トークンなしで 401 を返すことを確認する。
- [ ] **README 5**：Web をビルドして配信し、API の CORS と Firebase 設定を確認する。
  - Web のビルドには `VITE_FIREBASE_API_KEY`、`VITE_FIREBASE_AUTH_DOMAIN`、`VITE_FIREBASE_PROJECT_ID`、`VITE_FIREBASE_APP_ID`、`VITE_API_BASE_URL`（`https://api.<ドメイン>`。パスなし、`https` 必須）が**ビルド時に**必要。`VITE_LINE_ENABLED` は `false` のままにする（LINE は本番未接続）。
  - 配信方式は未決（要点 12）。Terraform の Pages プロジェクトは Git 連携先がプレースホルダで、デプロイ無効（誤デプロイ防止）。Pages にするならプレースホルダを実際のアカウント/リポジトリに直して有効化、Workers 静的アセットにするなら `apps/web/wrangler.toml`（`name = "kobito-support-web"`、`directory = "./dist"`）を使い、Terraform の Pages は使わない。[O/D] が決める。
  - API の CORS は `WEB_ORIGIN`（`https://app.<ドメイン>`）の 1 つだけを許可する。画面のドメインがこれと一致していることを確認する。
- [ ] **README 6**：メール送信、決済、バックアップ復元、各 Job の dry run 相当の手順を検証する（5〜8章）。最後に `scheduler_paused = false` にする（`retention` は `retention_scheduler_paused` で別に制御し、8.3 の確認まで `true` のまま）。

### 4.3 シークレットの登録

Terraform が Secret の**枠**を作る。値・バージョンは人が入れる。名前は `<name_prefix>-` に、環境変数名を小文字・ハイフンにしたものを付ける（`name_prefix` の既定は `kobito-support`）。

| Secret 名 | 中身 | 登録の時期 | Cloud Run に渡る条件 |
|---|---|---|---|
| `<prefix>-database-password` | Cloud SQL ユーザー `kobito_app` のパスワード | 4.2 の README 2 | Terraform が SQL ユーザーに設定 |
| `<prefix>-database-url` | `DATABASE_URL`（下記の形式） | Cloud SQL 作成後、Cloud Run の前 | 常時（API と全 Job） |
| `<prefix>-komoju-secret-key` | KOMOJU の API キー | 5章の後 | `komoju_enabled = true` のとき（API のみ） |
| `<prefix>-komoju-webhook-secret` | KOMOJU の Webhook 署名用の秘密値 | 5章の後 | `komoju_enabled = true` のとき（API のみ） |
| `<prefix>-resend-api-key` | Resend の API キー | Resend のドメイン検証の後 | `mail_enabled = true` のとき（API と notifications Job） |
| `<prefix>-mail-from` | 送信元アドレス | 同上 | 同上 |

**値をシェル履歴に残さない入れ方**（値を引数に書かない。画面にも出さない）：

```bash
# 値は対話入力（画面に表示されず、履歴にも残らない）
read -rs -p "値を入力: " SECRET_VALUE; echo
printf '%s' "$SECRET_VALUE" | gcloud secrets versions add <Secret名> \
  --project=<GCPプロジェクトID> --data-file=-
unset SECRET_VALUE
```

- 改行が入らないよう `printf '%s'` を使う（`echo` は使わない）。
- 値を `.env` やメモに残さない。値の中身を確認するコマンド（`versions access`）を共有画面で実行しない。
- Secret の版を追加しても、**実行中の Cloud Run のインスタンスには反映されない**（Terraform は `version = "latest"` を参照する。起動時に解決される一般的な動作）。キーを差し替えたら新しいリビジョンを出す（再デプロイ）。反映の確認は 6 章の通し確認で行う（未確認）。
- 差し替え前の版は、動作確認が済むまで無効化・破棄しない。

**`DATABASE_URL` の形式**：

- `config.ts` は `postgres://` または `postgresql://` で始まり、URL として有効な文字列を要求する。
- 空ホスト形式（`postgresql://kobito_app:…@/kobito_support?host=/cloudsql/…`）は `config.ts` の `.url()` に拒否される（`loadConfig` で `Invalid environment configuration: DATABASE_URL` になることを確認）。
- 次の形は `loadConfig` を通り、`pg` が `host=/cloudsql/…` をソケットのディレクトリとして解釈する（`new pg.Client({connectionString})` の `connectionParameters.host` で確認。`%40` や `%2F` を含むパスワードも復号された。接続そのものは Cloud SQL で未検証）：
  `postgresql://kobito_app:<URLエンコードしたパスワード>@localhost/kobito_support?host=/cloudsql/<プロジェクトID>:<リージョン>:<インスタンス名>`
- 接続名は `terraform output database_connection_name`。データベース名は `kobito_support`、ユーザーは `kobito_app`（`main.tf`）。パスワードの記号は URL エンコードする。

### 4.4 API イメージのビルドと登録 [D/O]

- [ ] `apps/api/Dockerfile` はリポジトリのルートをコンテキストにする（`COPY . .`）：`docker build -f apps/api/Dockerfile -t <リージョン>-docker.pkg.dev/<プロジェクト>/<リポジトリ>/<イメージ>:<タグ> .`。登録先は `terraform output artifact_registry_repository`（実行は未検証）。
- [ ] `docker push` の前に Artifact Registry への認証（`gcloud auth configure-docker <リージョン>-docker.pkg.dev`）が必要。
- [ ] ビルドに使う pnpm は Dockerfile で `pnpm@10.22.0` に固定されている（ルートの `packageManager` と一致）。
- [ ] イメージには Chromium と日本語フォント（Noto CJK）が入り、`INVOICE_CHROMIUM_EXECUTABLE=/usr/bin/chromium`、実行ユーザーは `node`（非 root）。**本番イメージをビルドして、非 root のコンテナ内で、日本語の PDF が生成できることは確認済み**（Chromium のサンドボックスは、コンテナ内のみ `INVOICE_CHROMIUM_SANDBOX=false` で無効。#56）。**Cloud Run 上の実動作とメモリは未確認**（API と日次ジョブは `pdf_render_memory`、既定 2Gi）（10.1）。
- [ ] イメージ内に `dist/server.js` と `dist/jobs/*-script.js` があることを確認する（未確認。`pnpm deploy --prod` が `dist` を含める前提）。
- [ ] `latest` ではなく**タグまたはダイジェストを固定**して `api_image` に渡す（戻し方が楽になる）。

### 4.5 DB のマイグレーション [D/O]

> **別PRで対応中：** 本番でのマイグレーション／seed の実行方法は別のPRで整備している。この節の手順は、そのPRの内容が決まるまで書き換えない。


- コマンドは `pnpm db:migrate`（= `@kobito/db` の `tsx scripts/migrate.ts`）。`db/migrations/` の `NNN_name.sql` を順に適用し、履歴は `schema_migrations`（ファイルの SHA-256 つき）に残す。排他ロックあり。現在 `001`〜`008`。
- **本番での実行場所**：本番コンテナには `tsx` も `db/` も入っていない（Dockerfile は API の本番依存だけを配置）。Cloud Run Jobs では実行できないため、**手元（または信頼できる作業端末）から Cloud SQL Auth Proxy 経由で実行する形**になる。Cloud SQL は公共 IPv4 が有効だが承認済みネットワークは設定していない（`main.tf`）ため、直接接続ではなく Proxy を使う。
- [ ] Cloud SQL Auth Proxy を起動する（`cloud-sql-proxy <接続名> --port 5432`。コマンドは未検証）。
- [ ] `DATABASE_URL` を**環境変数で**渡す。例：`postgresql://kobito_app:<パスワード>@127.0.0.1:5432/kobito_support`（パスワードは 4.3 と同じ方法で読み込む。コマンド行に直書きしない）。`dotenv` は既存の環境変数を上書きしないので、ローカルの `.env` があっても環境変数が優先される。
- [ ] `pnpm install --frozen-lockfile` の後、`pnpm db:migrate` を実行する。`Database migrations complete (N applied).` を確認する。
- [ ] **`pnpm db:reset` は本番では使わない。** データベースを作り直すコマンドで、ローカルの `kobito_support`（`localhost` 系のホスト）以外は拒否されるが、手順としても使わない。
- [ ] マイグレーションの実行前に Cloud SQL のバックアップを取る（9.2 の復元手順を参照）。
- [ ] CI は `docs/schema-v1.sql` を PostgreSQL 16 で検証しているが、`db/migrations` と schema-v1 が一致するかは、この調査では確認していない。

### 4.6 初期データ（seed）[D/O]

> **別PRで対応中：** 本番でのマイグレーション／seed の実行方法は別のPRで整備している。この節の手順は、そのPRの内容が決まるまで書き換えない。


- [ ] `pnpm db:seed`（`db/src/seed.ts`）を、4.5 と同じ接続で実行する。**本番でも必須。** 内容は次の通り（`on conflict do nothing`で何度実行しても安全）：
  - `plans`：ライト（5,000）、スタンダード（10,000）、プレミアム（15,000）、個別見積り。`valid_from` は 2026-10-25 で、価格は税抜（`price_excl_tax`）。
  - `settings` の初期キー：`service_name`（既定値あり）、`company_name`・`company_address`・`invoice_registration_no`（空）、`invoice_prefix`（`KS`）、`bank_account`（空の項目）、`contact_email`（既定値あり）、`konbini_fee_yen`（null）。
- [ ] 公開料金表（税別 5,000 / 10,000 / 15,000 円、追加 1 クレジット 4,000 円）と `plans` の値が一致することを確認する（追加クレジットの単価がどこに保存されるかは、この調査では未確認）。
- [ ] **開発用のデータ投入（`dev:seed-auth`、`dev:seed-billing`、`dev:seed-admin`）は本番で使わない。**
- [ ] seed の後に、2 章の発行者情報を管理画面から入れる。

### 4.7 管理者の登録（確認用 SQL）

> **別PRで対応中：** 本番の管理者アカウントの作成と TOTP の登録は別のPRで整備している。この節の手順は、そのPRの内容が決まるまで書き換えない。


管理者の Firebase ユーザー作成と TOTP 登録（3.3）の後、管理者の uid を DB に登録する。**未実行・未検証。**

```sql
-- <ADMIN_UID> は Firebase のユーザー ID（実在の値は書かない）
insert into user_accounts (auth_user_id, role) values ('<ADMIN_UID>', 'admin');
```

---

## 5. カードを有効にする前の確認

**`komoju_enabled` を `true` にするまで、カードは無効です。** Cloud Run に `KOMOJU_SECRET_KEY` / `KOMOJU_WEBHOOK_SECRET` が渡らないため、申込み画面のカード選択は出ず（`cardPaymentEnabled` は `KOMOJU_SECRET_KEY` の有無で決まる）、Webhook は 503 を返す（`webhook_unavailable`）。

### 5.1 W1（テストモードでの実測）の未確認点

出典：`docs/implementation-status.md`「W1（KOMOJU試作）の実測結果」、Terraform README。

| 項目 | 現状 | 判断が必要なこと |
|---|---|---|
| 月末（29〜31 日）の課金日 | **未確認。** 定期課金の `day` 指定は効かず、課金日は作成日と同じ。作成日が 1 日だったため月末の挙動は未検証 | 月末に再試験するか、定期課金を採用しない前提にするか |
| 失敗後の自動再試行 | **未確認。** 定期課金のオブジェクトに `retry_count` / `retry_at` はあるが、失敗するカードでの動作は未検証 | 再試行の有無と、通知（NT-05：失敗の翌日と 3 日後）との関係 |
| 定期課金 | **未採用。** 現在は**請求書ごとの単発の支払いリンク**（毎月お客様がリンクから支払う）。定期課金は作成の瞬間に初回が課金され、生成される `payment.captured` には請求番号が入らない | 自動課金にするか。しない場合、説明文・設計書（「カードは KOMOJU が自動課金」）との差を整理 |
| 請求番号の再利用 | 同じ `external_order_num` は加盟店内で一度しか使えない。支払いリンク作成時は請求番号の後ろに 6 文字の識別子を付けて送り、Webhook 側で外す（実装済み） | 本番でも同じ挙動かの確認 |
| カード拒否時 | セッションは未完了のまま。やり直しで成功すると `payment.captured` が届く（`failed` → `paid` の遷移で処理） | — |
| 加盟店名 | テスト環境のホスト画面に別名が表示された | 2 章：本番審査後に変更 |
| 解約時の定期課金の停止 | 定期課金が未実装のため対象外 | 自動課金にするなら要実装 |

### 5.2 KOMOJU の本番 Webhook の登録 [O]

- [ ] **URL**：`POST https://api.<ドメイン>/webhooks/komoju`（4.2 で `api.<ドメイン>` の疎通を確認した後）。
- [ ] **署名用の秘密値**：KOMOJU の設定で発行・設定した値を、そのまま Secret `<prefix>-komoju-webhook-secret` に登録する（`X-Komoju-Signature` を HMAC-SHA256 で原文バイト列に対して検証。KOMOJU 側と値が一致している必要がある）。
- [ ] **購読するイベント**：コードが業務処理するのは `payment.captured`、`payment.failed`、`payment.expired`、`payment.cancelled`（`subscription.captured` / `subscription.failed` も扱うが、定期課金を採用しない間は請求番号がなく「要確認」に回る）。それ以外のイベントは保存され、管理画面の要確認に出る（`review:unsupported_event`）。**まず上の 4 種に絞る。** KOMOJU 側のイベント名と選択肢の画面は未確認。
- [ ] Webhook は KOMOJU 側で最大 25 回・25 日再送される（設計書）。受信側はイベント ID で重複を無視し、受信後に処理を起動する。署名不正は 400、秘密値未設定は 503。
- [ ] 本番キーと本番の秘密値の組を、テストモードの組と取り違えない（6章の通し確認はテストモードのキーで行い、その後に本番のキーへ差し替える）。
- [ ] カード情報（番号・有効期限・コード・カードトークン）は保存もログ出力もしない設計。Webhook の保存項目は許可リストのみ（`webhooks/README.md`）。
- [ ] **返金・取消の運用を決める。** アプリには返金の機能はない（この調査で確認できず）。KOMOJU の管理画面で返金した場合のアプリ側の扱い（`payment.refunded` 等は購読対象外で「要確認」になる）、請求書の取消（5.3）との整合は未決。[O] が運用を決め、[D] が必要なら実装する。
- [ ] 初月期限後の入金、失効済みの申込みへの期限内入金の後日確認は、契約を復活させる運用が未確定。現在は自動成立を拒否する（`docs/implementation-status.md`）。

### 5.3 請求書の取消

請求書の取消（取消日・理由の記録）は PR #54、取消済みの請求書の PDF への「取消」表示は PR #55 で実装済み。PDF には取消日と「お支払いいただく必要はありません」の文言が載り、理由は載らない。発行時に保存した PDF は変更しない。取消の管理画面での操作の有無と、取消後の「出し直し」（置き換え）は未確認・後続。インボイス制度上の取消の扱い（税理士確認）は [O] が判断する。

---

## 6. 通し確認（本番直前のリハーサル）

目的：テストモードの KOMOJU で、申込み→審査→請求書→入金→契約成立→メール受信を 1 件通す。**本番のデータベースに実際の顧客データを入れる前に、別の環境（同じ構成のステージング）で行うのが望ましい。** 本番と同じ環境で行うなら、通し確認用のデータは「確認用」と分かる名前で作り、終わったら取り扱いを決める（削除手順は未整備。7年保存の対象かどうかは [O] が税理士と確認）。

準備：

- [ ] `mail_enabled = true`、`komoju_enabled = true`（**テストモードのキー**と Webhook 秘密値を Secret に登録済み）、`scheduler_paused = true` のまま。
- [ ] KOMOJU のテスト環境の Webhook に `https://api.<ドメイン>/webhooks/komoju` を登録する。
- [ ] 発行者情報（2章）が入り、`/admin/settings` が「発行可能」。
- [ ] 通し確認用の Resend 宛先として、受信を確認できる自分のメールアドレスを使う。

手順と確認の観点：

| # | 手順 | 確認する画面 | 確認するメール | その他（ログ・保存先） |
|---|---|---|---|---|
| 1 | 申込み（`app.<ドメイン>` の申込み画面）。カード選択が表示されること | 申込みの完了画面 | 受付（NT-01）。当社あて（S-03）が `contact_email` に届く | `notifications` に予定が入る。送信は `notifications` Job を手動実行（8章）して確認 |
| 2 | 管理画面で審査（審査完了・請求書を発行） | `/admin/customers`、請求書 | 初月請求書（NT-02） | 請求書の PDF が作られる。`pdf_storage_gcs_enabled = true` なら**GCS のバケットにオブジェクトができる**。Cloud Run のログに PDF 生成のエラーがない |
| 3 | 顧客のマイページで請求書の PDF を開く | `/me/invoices` | — | PDF が表示される（日本語が文字化けしない） |
| 4a | カード：請求書の支払いリンクからテスト決済 | KOMOJU のホスト画面（加盟店名が当社のものか確認） | 契約成立（NT-02b） | `payment.captured` が受信箱に入り、請求書が支払い済み・契約が成立・クレジット付与 |
| 4b | 銀行振込：`/admin/bank-transfers` で入金を記録 | 入金確認画面 | 契約成立（NT-02b） | 同上 |
| 5 | 失敗の確認：テストの失敗カードで支払う | 支払い画面でやり直せること | 失敗後の通知（翌日・3 日後のものは予定が入る） | `payment.failed` → 請求書が失敗に。管理画面「今日やること」の要確認に出る |
| 6 | Webhook の重複：同じイベントを再送する | — | 二重付与されない | イベントは 1 回だけ処理（受信箱は重複を無視） |
| 7 | 管理者の 2 段階認証なしでは管理 API に入れない | `/admin` | — | 403 |
| 8 | 顧客の分離：別の顧客でログインして他人の請求書にアクセスできない | — | — | 404/401 |
| 9 | パスワード再設定（3.2） | ログイン画面 | 再設定メール（Firebase 送信。差出人・件名・文面を確認） | — |

- [ ] 通し確認の項目は `docs/implementation-plan-v1.md` 8章を参考にした（元の項目にはコンビニ決済があるが、2026-10-27 の指示でコンビニは対象外）。
- [ ] 日付を 1 か月進める確認（二重に請求・付与・失効が起きない）は本番相当環境ではできない。ローカルの自動テストと `job:daily` の手動実行で確認する（7章・8章）。
- [ ] 確認後、**テストモードのキーを本番のキーに差し替え**、新しいリビジョンを出して反映する。差し替え後に Webhook の本番登録（5.2）を行う。
- [ ] 本番キーでの課金は、少額の実カードによる試験が可能か、返金運用とともに [O] が決める（この調査では未確認）。

---

## 7. 定時処理の準備（Job の確認）

Terraform は 3 つの Cloud Run Job と 3 つの Scheduler を作る（初期は Scheduler 停止）。

| Job | コマンド（本番イメージ） | 開発用のコマンド | Scheduler（東京時間） | 内容 |
|---|---|---|---|---|
| `<prefix>-daily` | `node dist/jobs/daily-billing-script.js` | `pnpm --filter @kobito/api job:daily` | `0 6 * * *` | 期間の切り替え、月額請求書の発行と PDF 生成、残りクレジットの失効、期限切れの失効、解約の終了。何度走らせても二重にならない。**決済プロバイダーは呼ばない** |
| `<prefix>-notifications` | `node dist/jobs/notifications-script.js` | `job:notifications` | `*/5 * * * *` | メール通知の送信（NT-01〜NT-07、S-03）。失敗は最大 3 回まで再試行。`MAIL_PROVIDER` 未設定なら予定を残して送らない |
| `<prefix>-retention` | `node dist/jobs/retention-script.js` | `job:retention` | `30 6 * * *` | 匿名化（個人情報の削除）。**データを変更する** |

本番イメージに `tsx` が無いため、Job は `pnpm job:*` ではなく `node dist/jobs/…` を直接実行する構成（Terraform README）。

- [ ] **（修正済み）Job の環境変数**：各 Job のスクリプトは `loadConfig(process.env)` を呼び、必須の `DATABASE_URL`・`FIREBASE_PROJECT_ID`・`WEB_ORIGIN` が無いと終了する。`main.tf` の 3 つの Job は、これらと `NODE_ENV`（とメール・PDF 関連）を渡すようになった（`WEB_ORIGIN` は API と同じ `https://app.<ドメイン>`）。**手動実行でログを確認するまで稼働可能とみなさない。**
- [ ] 各 Job が `dist/jobs/*-script.js` で起動できることを、イメージ内で確認する（Terraform README は「確認するまで稼働可能とみなさない」としている）。
- [ ] `daily` Job が PDF を作るため、Cloud Run Jobs 上で Chromium が動くか、メモリが足りるか（`pdf_render_memory`、既定 2Gi。実測のうえ調整）を手動実行で確認する（未確認）。
- [ ] `notifications` Job は `mail_enabled` のときだけ Resend の設定が渡る。`mail_enabled = false` の間は予定を残すだけで送らない。
- [ ] 終了コード：`daily` は失敗した契約があれば非 0、`notifications` は失敗が 1 件でもあれば非 0、`retention` は失敗があれば非 0。標準出力に結果が JSON で 1 行出る（Cloud Logging で確認）。

---

## 8. 定時処理の起動

**順序：** 手動実行で確認 → `retention` を dry-run で確認 → Scheduler を有効化。

手動実行（Scheduler が停止中でも実行できる）：

```bash
gcloud run jobs execute <prefix>-daily --region=<リージョン> --project=<プロジェクトID> --wait
gcloud run jobs execute <prefix>-notifications --region=<リージョン> --project=<プロジェクトID> --wait
```

### 8.1 `job:daily`

- [ ] 手動実行し、標準出力の JSON（`billing` と `lifecycle` の結果）で `failed` が 0 であること。
- [ ] 通し確認の契約で、対象日以外は何も作られない（0 件）こと、2 回続けて実行しても二重にならないこと。
- [ ] 月額請求書の発行（PDF 生成と保存）の確認は、翌期間の開始日が来る契約がないと実データでは起きない。ローカルの自動テストで確認済みの範囲と、本番での未確認の範囲を分けて記録する。

### 8.2 `job:notifications`

- [ ] 通し確認の通知（NT-01 など）が、手動実行で送信済みになり、メールが届く。失敗があれば `failed` が 0 でない（終了コード 1）。
- [ ] Resend の送信ログ（Resend の管理画面）にも記録される。
- [ ] 失敗した通知は、管理画面「今日やること」の通知の送信失敗一覧から確認し、再送できる（PR #51）。

### 8.3 `job:retention`（匿名化。初回は必ず dry-run）

`retention` は、解約・失効・承諾しない遷移から 1 年経過した顧客の個人情報を**匿名化**する。7 年保存の対象（契約・請求書・入金・台帳・同意）は変えないが、顧客の名前・連絡先・依頼内容は取り消せない。

dry-run の指定方法（`retention-script.ts`）：コマンドの引数に `--dry-run` を付ける（環境変数ではない）。件数だけを返し、変更しない。`--contract-id=<UUID>` で対象を絞れる。dry-run があるのは `retention` だけで、`daily` と `notifications` にはない。ローカルでは `pnpm --filter @kobito/api job:retention -- --dry-run`。

```bash
# dry-run（変更なし）。Job の引数を一時的に上書きして 1 回だけ実行する
gcloud run jobs execute <prefix>-retention --region=<リージョン> --project=<プロジェクトID> \
  --args="dist/jobs/retention-script.js,--dry-run" --wait
```

- [ ] dry-run の出力（標準出力の JSON）で、対象件数・`failed` を確認する。**初回の本番実行は、dry-run の対象が想定どおりと確認し、保持期間・監査の手順を承認した後に限る。**
- [ ] `gcloud` の `--args` の書式は上の例のとおりに動くかを含め、**未検証**。実行ログで `dryRun: true` の出力になっていることを必ず確認する。
- [ ] 注意：`retention` は Firebase のアカウントを削除しない（結果に、外部で削除が必要な uid を返すだけ）。除外（保留）の機能もない。顧客に未終了の契約が 1 つでもあれば対象外。
- [ ] **Scheduler の `retention` を dry-run 確認の前に動かさない。** `retention_scheduler_paused = true`（既定）の間は、`scheduler_paused = false` にしても `retention` は止まったまま。

### 8.4 Scheduler の有効化

- [ ] 8.1〜8.3 が終わり、Job の `WEB_ORIGIN` を含む `main.tf` の修正が適用済みである。
- [ ] `scheduler_paused = false` で `daily` と `notifications` を有効にする。`retention` は `retention_scheduler_paused` で別に制御する。8.3 の dry-run 確認と保持期間・監査の承認が済んでから `retention_scheduler_paused = false` にする。
- [ ] 適用後、Cloud Scheduler の画面で 3 つの状態を確認し、最初の実行（`notifications` は 5 分以内、`daily` は翌朝 6 時）の結果を Cloud Run Jobs の実行履歴で確認する。
- [ ] Scheduler は Cloud Run Jobs API を OAuth で呼ぶ（サービスアカウントに `roles/run.developer`）。権限不足で失敗する場合は Scheduler のログに出る（未確認）。

---

## 9. 切替当日のチェックリスト・戻し方・障害時の見る場所

### 9.1 当日のチェックリスト

- [ ] 前日までに：2〜8 章が完了している。発行者情報が管理画面で「発行可能」。管理者がログインできる。
- [ ] Cloud SQL のバックアップが直近のものがあり、PITR が有効（Terraform の設定）。**復元訓練は未実施**（Terraform README）。
- [ ] 本番のキーに差し替え済み（`KOMOJU_SECRET_KEY`、`KOMOJU_WEBHOOK_SECRET`）。KOMOJU の本番 Webhook を登録済み。
- [ ] `komoju_enabled = true`、`mail_enabled = true` で適用済み。
- [ ] `/healthz`、ログイン、申込み画面、管理画面が応答する。
- [ ] 切替直後は、少額のテスト申込み（自分）で 1 件通す（6 章の本番版）。
- [ ] Cloud Run のログに 5xx、`Invalid environment configuration`、PDF 生成エラーがない。
- [ ] 監視アラート（Cloud Run の 5xx、Cloud SQL の接続数）は通知チャンネルが未設定。**通知先（メール等）を設定する**（Terraform README：通知チャンネルは別途設定が必要）。
- [ ] 当日は Scheduler の初回実行を見届けられる時間帯に行う。

### 9.2 戻し方

| 状況 | 戻し方 | 備考 |
|---|---|---|
| 定時処理を止めたい | `scheduler_paused = true`（`daily`・`notifications`）と `retention_scheduler_paused = true`（`retention`）で適用、またはコンソール/`gcloud scheduler jobs pause <prefix>-<daily|notifications|retention> --location=<リージョン>` | 実行中の Job は止まらない。`gcloud run jobs executions cancel` で止める（コマンドは未検証） |
| カードを止めたい | `komoju_enabled = false` で適用 | `KOMOJU_SECRET_KEY` が外れ、申込み画面のカードが消える。Webhook は 503 になる。KOMOJU は再送する（最大 25 日）ので、再開後に処理される。**再開時の取りこぼしがないか受信箱を確認** |
| メールを止めたい | `mail_enabled = false` で適用 | `notifications` Job は予定を残して送らない（予定は残り、再開後に送られる。古い通知が一斉に送られる点に注意） |
| アプリを前の版に戻す | Cloud Run の以前のリビジョンへトラフィックを戻す（`gcloud run services update-traffic <prefix>-api --to-revisions=<リビジョン>=100`、未検証）。Terraform の `api_image` も前のタグに戻す | マイグレーションを適用済みの場合、古いコードと新しいスキーマの互換性を確認する（マイグレーションに「戻し」は用意されていない） |
| Job を前の版に戻す | `api_image` を戻して適用（Job は同じイメージを使う） | — |
| データを戻す | Cloud SQL のバックアップからの復元、または PITR（7 日間の WAL を保持、バックアップは 7 世代）。**新しいインスタンスへの復元が基本**（既存のものを上書きしない） | 復元後に `DATABASE_URL` / 接続名を切り替える必要がある。手順は未訓練。**事前に復元訓練を行うこと**（未実施） |
| 匿名化を取り消したい | **できない** | `retention` の本番実行は dry-run 確認後に限る |

### 9.3 障害時の見る場所

| 症状 | 見る場所 |
|---|---|
| 画面が出ない/ログインできない | Cloudflare の配信状況、ブラウザの開発者ツール（CORS: `WEB_ORIGIN` と画面のドメインの一致、`VITE_API_BASE_URL`）、Firebase の承認済みドメイン |
| API が 5xx | Cloud Run のログ（`<prefix>-api`）、Cloud SQL の接続数/CPU、監視アラート |
| 起動直後に落ちる | Cloud Run のリビジョンのログで `Invalid environment configuration: <変数名>`（値は出ない）。Secret の版が無い場合は起動に失敗する |
| 入金が反映されない | 管理画面「今日やること」の**支払いの要確認**（Webhook の受信箱で処理できなかったイベント）と**失敗した請求**。KOMOJU 管理画面の Webhook 配信履歴 |
| メールが届かない | 管理画面「今日やること」の**通知の送信失敗**（理由：`mail_http_4xx` / `mail_http_5xx` / `mail_network_error` など）と再送、Resend の管理画面、`notifications` Job の実行履歴 |
| PDF が出ない | Cloud Run のログ（`Invoice Chromium executable is not configured`、タイムアウト 15 秒など）、GCS のバケット、`pdf_storage_gcs_enabled` の設定 |
| 定時処理が動かない | Cloud Scheduler の状態（paused）とログ、Cloud Run Jobs の実行履歴と標準出力（JSON の結果）、Job の環境変数（7 章の `WEB_ORIGIN`） |
| 管理者がログインできない | Firebase の MFA 設定、`user_accounts` に管理者の行があるか（無いと 401）、TOTP の時刻ずれ |

---

## 10. 既知の未実装・未確認の一覧

出典は `docs/implementation-status.md`、各 README、コードの確認。**「実装済み」の項目でも、実環境（本番・実サービス）での確認は多くが未了**です。

### 10.1 外部サービスの実動作が未確認

| 項目 | 状況 |
|---|---|
| メールの実送信 | Resend のアダプターはあるが、実際の送信は未確認（`integrations/mail/README.md`）。SPF/DKIM の実検証、`Idempotency-Key` の API 対応も未確認 |
| GCS への PDF 保存 | アダプターは単体テストのみ。実際の GCS、IAM、metadata server は未検証（`integrations/storage/README.md`）。既存の Postgres 保存 PDF の移行はしない |
| HTML→PDF 変換が Cloud Run 上で動くか | Chromium（Debian パッケージ）と Noto CJK を同梱。ローカルでは非 root コンテナで生成できた。本番イメージの実ビルドで、非 root のコンテナ内で生成できることを確認（コンテナ内のサンドボックスは無効、#56）。Cloud Run/Jobs 上で動くか、メモリが足りるか（`pdf_render_memory` 2Gi）は**未確認** |
| KOMOJU の本番アカウント | 本番審査・加盟店名の変更・本番キーでの動作は未確認（テストモードのみ） |
| 定期課金 | 未採用。月末の課金日、失敗後の自動再試行は未確認 |
| 返金・取消の運用 | 運用方針が未決。アプリに返金機能はない |
| Terraform | `fmt` / `validate` / `plan` / `apply` を未実施。provider の属性は未検証 |
| Docker イメージ内での Job 起動 | 未確認（`dist/jobs/*-script.js`） |
| Cloud SQL の復元訓練 | 未実施。監視の通知チャンネルも未設定 |
| 管理者の本番 TOTP | Auth Emulator の SMS（電話）で通し確認済みだが、**本番の TOTP の通し確認は未実施**（`docs/implementation-status.md`）。TOTP の登録手段が未整備（3.3） |
| LINE | 連携ログイン・LIFF のコードはあるが、本番チャネル・LIFF・通知送信は未接続。`LINE_ENABLED` / `VITE_LINE_ENABLED` は `false` のままにする（Terraform は LINE の変数を一切渡さない） |
| パスワード再設定メール | 実際のメールの受信、テンプレート、遷移は未確認 |
| `api.<ドメイン>` の接続 | Cloud Run のドメインマッピングが Terraform に無い（4.2） |

### 10.2 機能の未実装・未決

| 項目 | 状況 |
|---|---|
| Firebase アカウントの削除 | `job:retention` は削除せず、削除が必要な uid を結果に返すのみ。外部操作の承認も別途必要 |
| 匿名化の保留（除外） | 機能なし（スキーマに項目がない）。過去の失効には遷移日がなく遡及補完できない |
| 報酬の消費税 | パートナーが課税事業者である前提の暫定計算。免税事業者・個人の扱い、パートナーからの請求書の要否は未決。報酬の支払日（`paid_on`）の記録と、紹介・報酬画面の「支払い済みにする」は PR #53 で実装済み |
| 請求書の取消 | 取消（PR #54）と取消 PDF の「取消」表示（PR #55）は実装済み。取消後の出し直しは後続（5.3） |
| 定期課金（自動課金） | 判断待ち。W1 の制約（作成時に初回課金、請求書への結びつけが別経路）あり。解約時の定期課金の停止も対象外 |
| 初月期限後の入金・失効後の入金 | 契約を復活させる運用が未確定。自動成立は拒否 |
| 追加クレジットの購入上限 | 1 回 10 個は暫定。KOMOJU のカードでの追加購入は実環境で未確認 |
| 通知文面 | 暫定のコード内テンプレート（設計書の「設定で変えられる」は未実装） |
| 見積送付の通知 | 実装が未確認（`docs/implementation-status.md` 画面整備の記載では未実装） |
| 発行者設定外の設定 | `contact_email` は管理画面で編集不可（SQL）。公開法務文書の URL・版の本番での設定先が未確認 |
| 管理者のパスワード再設定 | 画面なし。顧客の再設定後の遷移先もアプリ内に画面なし |
| ダッシュボード・先行利用・パートナー登録/編集画面 | 後続（`docs/implementation-status.md`） |
| 環境変数と `settings` の二重 | 発行者情報の環境変数（`INVOICE_REGISTRATION_NO` など）と Terraform の `company_name` / `service_name` / `invoice_prefix` は請求書に効かない（2章）。整理が必要 |
| Job の `WEB_ORIGIN`、`scheduler_paused` の粒度 | 解消済み（7章、8.4） |
| Cloud Pages の連携先 | プレースホルダ（`YOUR_GITHUB_ACCOUNT` / `YOUR_REPOSITORY`）。`wrangler.toml` と二重の配信方式（4.2） |

### 10.3 文書とコードの食い違い（古い記述）

| 文書 | 記述 | 現状 |
|---|---|---|
| `apps/api/src/webhooks/README.md`、`integrations/README.md`、`jobs/README.md`、`docs/implementation-status.md`、`infra/terraform/README.md`（`DATABASE_URL` の例） | 古い記述 | **解消済み**（現状に合わせて更新） |
| `.env.example` | 発行者情報の環境変数が並ぶ | 請求書の発行は `settings` を使い、環境変数は使わない（未解消、2章） |

設計書・要件定義などの正本（`docs/` の既存ファイル）は変更していません。残る食い違いは、オーナーが判断してください。
