# コビトサポート

TypeScript の基幹システムです。設計と作業順は `docs/` を参照してください。

## 現在の段階

開発基盤、共通計算・入力検証、認証付きAPI、顧客ログイン、5手順の申込フォームと受付保存、管理者の2段階認証・審査一覧・詳細・「承諾しない」の操作まで実装しています。顧客ホームには本人の店舗名・担当者名を表示します。審査完了からの請求書発行・入金確認・依頼の画面は後続の実装です。

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

## 申込フォームのローカル確認

`/apply/shop` から、お店・プラン・お支払い・ご要望・確認の5手順を進めます。現段階の支払方法は銀行振込で、申込完了時点の契約状態は「審査待ち」です。請求書の発行や契約成立はまだ行いません。

公開用の法務文書が未確定の場合、ローカル開発でのみ草案を参照できます。`.env` に確認用の文書URLと、その文書に明記された版を設定してください。公開リポジトリに文書の非公開部分や住所・口座などをコピーしないでください。

```dotenv
LEGAL_TERMS_URL=
LEGAL_TERMS_VERSION=
LEGAL_PRIVACY_URL=
LEGAL_PRIVACY_VERSION=
LEGAL_DISCLOSURE_URL=
LEGAL_DISCLOSURE_VERSION=
OPERATIONS_EMAIL=
```

URLはHTTPSを指定します。`OPERATIONS_EMAIL` は任意の運営通知先で、空欄なら運営宛通知は作成しません。開発用の設定は次のコマンドで反映します。既存データを残す場合は `db:reset` を使わないでください。

```sh
pnpm db:migrate
pnpm dev:seed-auth
```

草案の受付は開発モード・デモ認証プロジェクト・loopback上のAuth Emulatorと開発DBに限定します。法務設定がない場合や、本番で草案のままの場合は受付を停止します。草案の参照を設定しても、本番公開の承認を意味しません。

新規アカウントの作成は最終送信時にFirebase SDKで行い、申込APIにはIDトークンとパスワードを除いた入力を送ります。DB側の顧客・アカウント対応・申込・契約・同意・通知予定は同じトランザクションで保存します。途中でDB保存に失敗しても、作成した認証ユーザーを使って同じ受付キーで再試行できます。ID PlatformとPostgreSQLを同じトランザクションにはできないため、認証ユーザー作成とDB保存はこの境界で分けています。

確認画面の料金・条件と法務文書の版をサーバーで照合し、変更時は再確認を求めます。通知は `notifications` に送信待ちとして記録するだけで、外部へのメール送信は行いません。既存の紹介コードがある場合は有効性を確認し、紹介先への情報提供の同意も保存します。

## 管理者のローカル審査確認

`.env` の `DEV_ADMIN_EMAIL`、`DEV_ADMIN_PASSWORD`（12文字以上）、`DEV_ADMIN_PHONE`（確認用のE.164形式番号）を設定します。これらはローカルAuth Emulator専用です。通常の顧客アカウントを管理者へ変更する用途には使えません。

```sh
pnpm dev:seed-admin
```

起動済みの画面で `http://localhost:5173/admin/login` を開き、上記のメールアドレス・パスワードでログインします。確認コードの入力画面に進んだ後、別のターミナルで次を実行して、最新のローカル確認コードを入力してください。

```sh
pnpm dev:admin-code
```

Auth EmulatorはSMS方式の二段階認証に対応していますが、TOTPは未対応です。この手順は実際のSMSを送らずに、エミュレータの認証処理で第2要素付きトークンを得て、通常の管理API制限を検証します。本番は登録済みのTOTPを使う画面実装で、ローカルのSMS確認は本番TOTPの通し確認を代替しません。認証トークンやカスタムクレームを偽造して管理APIを通す仕組みはありません。

`/admin` から審査待ちの一覧を検索し、顧客詳細で申込時の料金・クレジット・同意内容を確認できます。「承諾しない」は申込・契約の状態と操作記録・通知予定を同じトランザクションで保存します。同じ理由での再送は結果を変えず、異なる理由での上書きは拒否します。審査完了と請求書発行は後続の実装です。通知は送信待ちの記録のみで、実際のメールは送りません。

管理者セッションは通常の顧客ログインと分離しています。ブラウザ表示の制限に加えて、API側でもDB上の管理者役割・第2要素・トークン失効状態を検証します。

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
