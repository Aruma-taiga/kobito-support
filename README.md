# コビトサポート

TypeScript の基幹システムです（`apps/web`＝画面、`apps/api`＝API、`packages/shared`＝共通の計算・検証、`db`＝マイグレーション、`infra`＝インフラ草案、`docs`＝設計書）。

- 設計の正本：[docs/system-design-v1.md](docs/system-design-v1.md)（ほかの設計書も `docs/` にあります）
- 実装と検証の記録：[docs/implementation-status.md](docs/implementation-status.md)
- 本番切替の手順と未確認一覧：[infra/GO-LIVE.md](infra/GO-LIVE.md)
- Terraform の草案：[infra/terraform/README.md](infra/terraform/README.md)

## 現在の段階

開発中です。**本番へのデプロイ、実顧客の運用、実メール送信はまだ行っていません。**

### 現在できること（実装済み）

- 申込み（5手順）、受付保存、審査（承認・「承諾しない」）、個別見積り（版管理・顧客の了承）
- 請求書の発行（PDF 保存）、顧客・管理者の一覧・詳細・ダウンロード、請求書の取消（取消 PDF の表示つき）
- 入金：銀行振込の確認、カード（KOMOJU の支払いリンクと Webhook の反映）、「要確認」の入金の解決。契約成立とクレジット付与
- 依頼・見積（版管理）・顧客の了承とクレジット予約・完了時の消費、追加クレジットの購入
- 毎日の定時処理（期間の切り替え、月額請求書、クレジットの失効、期限切れの失効、解約の終了）
- メール通知（送信待ちの記録、送信、3回までの再送）と、管理画面での送信失敗の確認
- 紹介・報酬の計算、報酬の支払日の記録
- 解約予定・取消・終了、削除予定と匿名化
- 管理画面（共通UI・左メニュー・今日やること・顧客・請求書・依頼・振込・紹介と報酬・削除予定・発行者設定）と、管理者の TOTP 登録画面
- お客様のマイページ（契約内容・請求書・依頼と見積・初回案内）

### 実環境で確認済みのもの

- KOMOJU テストモード：支払いリンクの作成、カード決済、拒否カードの失敗から同じ画面でのやり直し、署名つき Webhook の手元配信による入金反映（再配信しても二重にならない）
- 本番用 Docker イメージ（非 root）での日本語 PDF の生成
- `migrate` イメージによるマイグレーションと seed（PostgreSQL 16 で、2回目は 0 本適用）
- 実 PostgreSQL に対する DB テスト（`pnpm test:db`）

### 未確認・未実装のもの

- Cloud Run / Cloud Run Jobs 上での動作、Terraform の `plan`/`apply`（草案のみ）
- Cloud Storage（`PDF_STORAGE=gcs`）の実バケットでの動作
- メールの実送信（Resend のアカウント・送信ドメイン設定を含む）
- Firebase の本番での管理者 TOTP の登録とログイン（ローカルは Auth Emulator の SMS 方式で確認）
- KOMOJU の本番キー、KOMOJU から公開 URL への実際の Webhook 配信
- 定期課金は未採用。カードは**請求書ごとの単発の支払いリンク**（毎月お客様が支払う）
- 報酬の消費税は、パートナーが課税事業者である前提の暫定計算。パートナーの登録・編集画面は未実装
- LINE は `LINE_ENABLED=false` が既定で、画面・API とも非表示。本番チャネルと通知送信は未接続
- Firebase アカウントの削除（匿名化 job は削除が必要な uid を返すのみ）
- 請求書の取消後の出し直し、通知文面の設定化

全体の一覧は [infra/GO-LIVE.md の第10章](infra/GO-LIVE.md) と [docs/implementation-status.md](docs/implementation-status.md) を参照してください。

## 必要なもの

- Node.js 22.22.2 以上
- Corepack（pnpm 10.22.0 は `packageManager` で固定）
- Docker Compose（ローカルの PostgreSQL と Auth Emulator 用）

既存のグローバル設定を変えず、このリポジトリ内だけで Corepack shim を使う場合：

```sh
mkdir -p .tools/bin
corepack enable --install-directory "$PWD/.tools/bin"
export PATH="$PWD/.tools/bin:$PATH"
pnpm install --frozen-lockfile
```

`.tools/` は Git 管理外です。

## ローカル確認

### 1. 設定と DB

`.env.example` は空欄の見本です。コピーして `.env`（Git 管理外）を作り、ローカル開発値を設定します。

```sh
cp .env.example .env
```

最低限の値：

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://kobito:kobito@127.0.0.1:55433/kobito_support
FIREBASE_PROJECT_ID=demo-kobito-support
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
WEB_ORIGIN=http://localhost:5173
INVOICE_PREFIX=KS
POSTGRES_USER=kobito
POSTGRES_PASSWORD=kobito
POSTGRES_DB=kobito_support
POSTGRES_PORT=55433
DEV_AUTH_EMAIL=<ローカル専用のメールアドレス>
DEV_AUTH_PASSWORD=<8文字以上のローカル専用パスワード>
VITE_FIREBASE_API_KEY=fake-api-key
VITE_FIREBASE_AUTH_DOMAIN=demo-kobito-support.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-kobito-support
VITE_FIREBASE_APP_ID=1:000000000000:web:local-preview
VITE_API_BASE_URL=http://127.0.0.1:3000
VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099
```

- 会社名・住所・インボイス登録番号・振込先の実行時の正本は `settings` テーブル（管理画面 `/admin/settings`）です。`.env` の同名の変数（`COMPANY_NAME`、`INVOICE_REGISTRATION_NO`、`BANK_ACCOUNT_*` など）は請求書の発行には使われません。架空の値で補わないでください。
- PostgreSQL（`.env` の `POSTGRES_PORT`。上の例は 55433。未設定の docker-compose の既定は 5432 で、`DATABASE_URL` と揃える）と Auth Emulator（`127.0.0.1:9099`）は loopback のみに公開します。

```sh
docker compose up -d
docker compose ps
pnpm db:reset        # kobito_support を削除して作り直し、migration と seed を適用（データが消えます）
pnpm db:migrate      # reset を使わず、スキーマだけ更新する場合
pnpm db:seed         # プランと初期設定の追加（既存の設定は上書きしない）
```

`db:reset` は loopback 上の `kobito_support` だけを対象にし、DB の準備ができるまで待ってから実行します。migration は 1 本ずつトランザクションで適用し、checksum を `schema_migrations` に記録します。

### 2. 起動と顧客ログイン

```sh
pnpm dev:seed-auth   # Auth Emulator に開発ユーザーを登録（契約なしのアカウント）
pnpm dev             # API（:3000）と web（:5173）を起動
```

`http://localhost:5173/login` でログインします。業務の流れは、`/apply/shop` の申込みから作ったローカル顧客と、管理者の審査・確認用の入金記録で確認してください。API だけの起動は `pnpm dev:api`、`pnpm dev:smoke-auth` は Auth Emulator のトークンで `/api/v1/me` を呼ぶ確認です（トークンは表示しません）。

申込みの法務文書は、ローカル開発に限り草案を参照できます。`.env` に `LEGAL_TERMS_URL`／`LEGAL_TERMS_VERSION`、`LEGAL_PRIVACY_*`、`LEGAL_DISCLOSURE_*`（URL は HTTPS）と、任意の運営通知先 `OPERATIONS_EMAIL` を設定し、`pnpm db:migrate` と `pnpm dev:seed-auth` で反映します。法務設定がない場合、本番で草案のままの場合は受付を停止します。草案の参照は本番公開の承認ではありません。

### 3. 管理者（ローカル）

`.env` に `DEV_ADMIN_EMAIL`、`DEV_ADMIN_PASSWORD`（12文字以上）、`DEV_ADMIN_PHONE`（E.164 形式）を設定します（ローカルの Auth Emulator 専用）。

```sh
pnpm dev:seed-admin
# http://localhost:5173/admin/login でログインし、確認コード画面で別ターミナルから：
pnpm dev:admin-code
```

Auth Emulator は SMS 方式の第2要素のみ対応で、TOTP は未対応です。本番は TOTP（`/admin/enroll` で登録）で、ローカルの SMS 確認は本番 TOTP の通し確認の代わりにはなりません。

### 4. 請求書プレビューと PDF

PDF の生成には Chromium と日本語フォントが必要です（API の Docker イメージには含まれます）。ローカルで試すには `.env` に次を設定します。

```dotenv
DEV_INVOICE_PREVIEW=1
INVOICE_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium
```

```sh
pnpm dev:seed-billing   # 開発専用。既存の会社・登録番号・銀行設定は上書きしない
```

プレビュー請求書には「開発用サンプル・お支払い不要」と表示し、通知予定を作りません。本番（`NODE_ENV=production`）では `DEV_INVOICE_PREVIEW=1` を拒否します。

### 5. 検査

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db      # 実 PostgreSQL が必要（kobito_support_test を自動作成）
pnpm check        # lint + typecheck + test
```

CI は PostgreSQL 16 で migration を2回実行し、seed と DB テストを確認します。

## 運用コマンドと環境変数

環境変数の定義と検証は [apps/api/src/platform/config.ts](apps/api/src/platform/config.ts) です。必須は `DATABASE_URL`・`FIREBASE_PROJECT_ID`・`WEB_ORIGIN` の3つで、設定エラーには変数名だけを出し、値は出しません。

### 定時処理（jobs）

```sh
pnpm --filter @kobito/api job:daily                    # 期間の切り替え・月額請求書・失効・解約の終了
pnpm --filter @kobito/api job:notifications            # メール通知の送信（3回まで再送）
pnpm --filter @kobito/api job:retention -- --dry-run   # 匿名化の対象件数だけ確認（変更しない）
pnpm --filter @kobito/api job:retention                # 匿名化（データを変更する）
```

- `--dry-run` は `job:retention` だけが対応します。`job:daily` は何度走らせても二重になりません。
- `job:notifications` は `MAIL_PROVIDER` が未設定だと送らず、予定のまま残します。
- 本番イメージには `tsx` がなく、`node dist/jobs/*-script.js` で実行します。詳細は [apps/api/src/jobs/README.md](apps/api/src/jobs/README.md)。

### 管理者の作成とイメージ

```sh
pnpm --filter @kobito/api admin:bootstrap -- --email=<メール>   # 管理者アカウントの作成（本番向け）
docker build -f apps/api/Dockerfile -t kobito-support-api .                         # API 用（Chromium・日本語フォント入り）
docker build -f apps/api/Dockerfile --target migrate -t kobito-support-migrate .    # マイグレーション＋seed 用
```

`admin:bootstrap` による本番での TOTP 登録・ログインは未確認です。設定値と秘密はイメージに含めず、実行環境から渡します。

### 主な環境変数

| 変数 | 意味 |
|---|---|
| `MAIL_PROVIDER` | `log`（開発用。件名と宛先の一部だけをログに出し、送らない）／`resend`。未設定なら送信しない |
| `RESEND_API_KEY`、`MAIL_FROM` | `MAIL_PROVIDER=resend` のとき必須。`MAIL_FROM` は `名前 <a@b.c>` または `a@b.c` |
| `KOMOJU_SECRET_KEY` | 設定するとカードが有効（申込み・審査完了・支払いリンク）。未設定ならカードは無効 |
| `KOMOJU_WEBHOOK_SECRET` | `POST /webhooks/komoju` の署名（HMAC-SHA256）検証用。未設定なら 503 |
| `PDF_STORAGE`、`PDF_BUCKET` | PDF の保管先。`postgres`（既定・ローカル確認用）／`gcs`（`PDF_BUCKET` 必須。実バケットは未確認） |
| `LINE_ENABLED`、`VITE_LINE_ENABLED` | LINE 連携の有効化（API／web）。既定 `false`（画面・API とも非表示） |
| `LINE_LOGIN_CHANNEL_ID`、`VITE_LINE_LIFF_ID` | LINE ログインチャネル／LIFF。有効化する場合のみ |
| `DEV_INVOICE_PREVIEW`、`FIREBASE_AUTH_EMULATOR_HOST` | ローカル専用。本番では拒否 |

`VITE_` 変数は bundle に含まれるため、秘密を入れないでください。本番の web build には実プロジェクトの Firebase public config と HTTPS の API URL が必要で、demo project・fake API key・Auth Emulator は拒否されます。

## 設計上の決まり

- カード番号・セキュリティコード・有効期限・カードトークンは受け取らず、保存もログ出力もしません。カード入力は KOMOJU の画面で行い、Webhook からは許可した項目（イベント ID・種類・決済 ID・状態・金額・通貨・請求番号）だけを保存します。
- 顧客 API は認証された顧客 ID で必ず絞り、管理 API は DB 上の管理者役割と第2要素の両方を要求します。web は API だけを通して業務データにアクセスします。
- 金額は税抜で保存し、消費税は請求書ごとに小計×10% を一度だけ切り捨てます。固定プラン（税別）はライト 5,000円・1C、スタンダード 10,000円・3C、プレミアム 15,000円・5C、追加 1C は 4,000円です。発行済み請求書と PDF は書き換えません。
- 支払方法はカードと銀行振込です。コンビニ決済は対象外です（過去データの `konbini` は履歴として読めるだけ）。
- Webhook は原文バイト列で署名を検証し、本文のイベント ID で重複を排除します。当方が作っていない支払いの通知は再送され続けないよう受けて無視し、金額の不一致などは「要確認」として財務記録を変えずに残します。
- 申込みでは、Firebase のアカウント作成（SDK）と DB 保存を同じトランザクションにできないため、境界を分け、同じ受付キーで再試行できるようにしています。

## 共通パッケージ

`@kobito/shared`（`pnpm build:shared`）は DB・ネットワークに触れない料金・期間・クレジット・請求番号の計算と入力検証です。請求期間の `zeroBasedSeq` は 0 始まりで、DB の `billing_periods.seq` には 1 を加えて保存します。
