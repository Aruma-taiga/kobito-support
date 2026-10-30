# コビトサポート

TypeScript の基幹システムです。設計と作業順は `docs/` を参照してください。

## 現在の段階

PR1〜PR5 で、pnpm workspace、環境設定の検証、PostgreSQL 16 と Firebase Auth Emulator、migration runner・初期 seed、共通 domain package、Hono API skeleton、顧客ログイン画面を用意しています。ログイン後は API から取得した店舗名・担当者名だけを表示します。申込・請求・依頼の業務 API と画面はまだありません。

## 必要なもの

- Node.js 22.22.2 以上（web test toolchain の jsdom が Node 22.22.2 以上を要求）
- Corepack
- Docker Compose

リポジトリに pnpm 10.22.0 を `packageManager` で固定しています。既存の Volta などのグローバル設定は変更せず、このリポジトリ内だけで Corepack shim を使うには:

```sh
mkdir -p .tools/bin
corepack enable --install-directory "$PWD/.tools/bin"
export PATH="$PWD/.tools/bin:$PATH"
pnpm --version
pnpm install --frozen-lockfile
```

`.tools/` は Git 管理外です。Node.js 22.22.2 以上と pnpm 10.22.0 が使われていることを確認してください。

## ローカル設定と DB

空欄の `.env.example` はそのまま実行設定には使えません。コピーして、次のローカル開発値を `.env` に設定してください。会社名、住所、インボイス登録番号、銀行口座は空欄のままです。コンビニ払いの手数料は未決のため、seed でも `null` にします。

```sh
cp .env.example .env
```

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://kobito:kobito@127.0.0.1:55433/kobito_support
TEST_DATABASE_URL=
FIREBASE_PROJECT_ID=demo-kobito-support
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
WEB_ORIGIN=http://localhost:5173
SERVICE_NAME=
COMPANY_NAME=
INVOICE_PREFIX=KS
INVOICE_REGISTRATION_NO=
BANK_ACCOUNT_NAME=
BANK_ACCOUNT_BRANCH=
BANK_ACCOUNT_TYPE=
BANK_ACCOUNT_NUMBER=
POSTGRES_USER=kobito
POSTGRES_PASSWORD=kobito
POSTGRES_DB=kobito_support
POSTGRES_PORT=55433
DEV_AUTH_EMAIL=
DEV_AUTH_PASSWORD=
```

Auth Emulator に登録するため、`DEV_AUTH_EMAIL` と `DEV_AUTH_PASSWORD` はローカル専用の値で埋めてください（password は8文字以上）。

PostgreSQL は `127.0.0.1:55433`、Auth Emulator は `127.0.0.1:9099` のみに公開します。Postgres の既定 port を使う場合は `DATABASE_URL` と `POSTGRES_PORT` を合わせてください。reset は Postgres が起動中なら loopback 接続を最大30回（各接続500ms timeout、半秒間隔）試し、準備前は DROP を行いません。`pnpm db:reset` は loopback 上の `kobito_support` のみを削除して作り直します。データが消えるので、必要な値があるときは先に退避してください。テストも `kobito_support_test` だけを自動作成・初期化し、他 DB は使いません。

```sh
docker compose up -d
docker compose ps
pnpm db:reset
pnpm test:db
```

## Web ログイン画面

`.env` に次のローカル用 Vite 設定を追加してください。これらは Firebase Auth Emulator のデモ値です。

```dotenv
VITE_FIREBASE_API_KEY=fake-api-key
VITE_FIREBASE_AUTH_DOMAIN=demo-kobito-support.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-kobito-support
VITE_FIREBASE_APP_ID=1:000000000000:web:local-preview
VITE_API_BASE_URL=http://127.0.0.1:3000
VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099
```

`.env` の `DEV_AUTH_EMAIL` と `DEV_AUTH_PASSWORD` にローカル専用値を設定し、上の DB 初期化後に開発ユーザーを登録してから API と web dev server を起動します。

```sh
pnpm dev:seed-auth
pnpm dev
```

`http://localhost:5173/login` を開き、`.env` に設定した認証情報でログインしてください。

ログイン後の `/me` は API の `/api/v1/me` を呼び出し、店舗名と担当者名を表示します。web は起動時に public config API からサービス名を取得します。本番 web build には実プロジェクトの Firebase public config と HTTPS API URL を指定してください。開発用 demo project、fake API key、Auth Emulator は本番 build で拒否されます。Vite の `VITE_` 変数は bundle に含まれるため、server secret を設定しないでください。

## API と Auth Emulator

API は Firebase Admin SDK で ID token を検証し、`user_accounts` の UID・role・customer ID を認証情報として使います。顧客 API は認証された customer ID で必ず絞り、管理 API の namespace は DB role と ID token の第2要素の両方を要求します（現在、管理用の業務 endpoint はありません）。公開 config は `settings.service_name` だけを返し、会社情報・銀行情報などは含みません。

上記のローカルセットアップで DB を初期化し、`pnpm dev:seed-auth` を実行してから API を起動してください。API だけを別起動するときは次を使います。

```sh
pnpm dev:api
```

`pnpm dev:seed-auth` は設定済みのローカル Auth Emulator に開発ユーザーを登録し、DB に customer account を用意します。`pnpm dev:smoke-auth` は Auth Emulator の sign-in REST API から ID token をメモリ上で取得し `/api/v1/me` を呼びます。token とプロフィールは表示しません。

```sh
# 別ターミナル
pnpm dev:smoke-auth
```

Container image は repository root を build context にして作ります。設定値と secrets は image に含めず、Cloud Run の environment variables・secret injection から渡します。

```sh
docker build -f apps/api/Dockerfile -t kobito-support-api .
```

API の unit / integration tests と package build は CI で実行します。ローカルでは `pnpm test`、`pnpm test:db`、`pnpm build:api` を使います。

`db:reset` を使わずスキーマだけ適用する場合:

```sh
pnpm db:migrate
pnpm db:seed
```

初期 migration は `docs/schema-v1.sql` の byte-for-byte copy です。migration ごとに checksum と適用日時を `schema_migrations` に保存し、1 migration 単位の transaction と PostgreSQL advisory lock で二重適用を防ぎます。`db:seed` はプランと初期設定を追加し、既存の設定値を上書きしません。サービス名の初期値は「コビトサポート（kobITo Support）」、請求番号 prefix は `KS` です。

## 検査

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
```

Pull Request CI は PostgreSQL 16 に対して migration を2回実行し、seed と DB integration tests を確認します。

## 共通 domain package

`@kobito/shared` は Node と web で共有する純粋な計算・型・validation です。DB やネットワークへ接続せず、利用側で料金表示や申込 API validation に使います。package をビルドするには:

```sh
pnpm build:shared
```

主な API は `splitTax(grossYen)` / `invoiceTotals(lineGrossYen[])`、`periodFor(anchor, zeroBasedSeq)`、`balanceOf(entries)` / `canApprove(estimateCredits, balance)`、`formatInvoiceNo(prefix, year, sequence)` と申込フォーム schema です。請求期間の `zeroBasedSeq` は開始を 0 とし、DB の `billing_periods.seq` に保存するときは 1 を加えます。請求書の税額は明細ごとではなく、請求書の税込合計に対して一度だけ計算します。
