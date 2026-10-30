# コビトサポート

TypeScript の基幹システムです。設計と作業順は `docs/` を参照してください。

## 現在の段階

PR1〜PR3 で、pnpm workspace、環境設定の検証、PostgreSQL 16 と Firebase Auth Emulator のローカル環境、migration runner・初期 seed、共通 domain package（料金・税額、請求期間、クレジット、状態遷移、申込入力 validation）と lint・型検査・unit / PostgreSQL integration tests を用意しています。まだ申込画面、API routes、ログインフローなどの業務アプリはありません。`pnpm dev` はありません。

## 必要なもの

- Node.js 22 以上
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

`.tools/` は Git 管理外です。Node.js 22 以上と pnpm 10.22.0 が使われていることを確認してください。

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
```

PostgreSQL は `127.0.0.1:55433`、Auth Emulator は `127.0.0.1:9099` のみに公開します。Postgres の既定 port を使う場合は `DATABASE_URL` と `POSTGRES_PORT` を合わせてください。reset は Postgres が起動中なら loopback 接続を最大30回（各接続500ms timeout、半秒間隔）試し、準備前は DROP を行いません。`pnpm db:reset` は loopback 上の `kobito_support` のみを削除して作り直します。データが消えるので、必要な値があるときは先に退避してください。テストも `kobito_support_test` だけを自動作成・初期化し、他 DB は使いません。

```sh
docker compose up -d
docker compose ps
pnpm db:reset
pnpm test:db
```

`db:reset` を使わずスキーマだけ適用する場合:

```sh
pnpm db:migrate
pnpm db:seed
```

初期 migration は `docs/schema-v1.sql` の byte-for-byte copy です。migration ごとに checksum と適用日時を `schema_migrations` に保存し、1 migration 単位の transaction と PostgreSQL advisory lock で二重適用を防ぎます。`db:seed` はプランと初期設定を追加し、既存の設定値を上書きしません。サービス名の初期値は「コビトサポート（kobITo Support）」、請求番号 prefix は `KS` です。公開設定 API は未実装です。

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
