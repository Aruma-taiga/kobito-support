# コビトサポート

TypeScript の基幹システムです。設計と作業順は `docs/`、残りの実装と外部検証は [実装状況](docs/implementation-status.md) を参照してください。

## 現在の段階

開発基盤、共通計算・入力検証、認証付きAPI、顧客ログイン、5手順の申込フォームと受付保存、管理者の2段階認証・申込審査、審査完了からの初月請求書発行・PDF保存、顧客と管理者の請求書一覧・詳細・ダウンロード、銀行振込の入金確認と契約成立まで実装しています。顧客ホームには店舗名・担当者名、契約状態と利用期間・残りクレジットを表示します。依頼登録・見積の版管理・顧客了承とクレジット予約も実装しています。完了時の予約取消・実績消費も実装しています。審査・入金待ち、初回案内、申込み終了後の画面とAPIの閲覧制限も実装しています。月次処理・実際の通知送信は後続の実装です。

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

空欄の `.env.example` はそのまま実行設定には使えません。コピーして、次のローカル開発値を `.env` に設定してください。会社名、住所、インボイス登録番号、銀行口座は空欄のままです。現在使える支払方法は銀行振込で、カード決済は後続の実装です。コンビニ決済は対象外です。

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

`/apply/shop` から、お店・プラン・お支払い・ご要望・確認の5手順を進めます。現段階の支払方法は銀行振込で、申込完了時点の契約状態は「審査待ち」です。申込を送信するだけでは請求書の発行や契約成立は行いません。

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

`/admin` から審査待ちの一覧を検索し、顧客詳細で申込時の料金・クレジット・同意内容を確認できます。「承諾しない」は申込・契約の状態と操作記録・通知予定を同じトランザクションで保存します。同じ理由での再送は結果を変えず、異なる理由での上書きは拒否します。固定プランの「審査完了・請求書を発行」は初月請求書を作成し、契約を入金待ちへ進めます。個別見積りは見積作成待ちへ進み、金額を仮定した請求書は作りません。通知は送信待ちの記録のみで、実際のメールは送りません。

管理者セッションは通常の顧客ログインと分離しています。ブラウザ表示の制限に加えて、API側でもDB上の管理者役割・第2要素・トークン失効状態を検証します。

## 発行者設定の管理

管理者の2段階認証で `/admin/settings` を開き、サービス名・会社名・住所・インボイス登録番号・請求番号の接頭辞・振込先を編集します。未確定の会社情報や銀行口座を架空の値で補わず、空欄のまま保存できます。画面に表示する発行者情報の入力状況は、本番PDF保管や法務文書の準備完了を意味しません。

保存時は取得した版を照合します。別の管理者が先に変更した場合は競合を表示し、最新の内容を読み直してから編集します。発行済み請求書・PDFは発行時の情報を保持し、変更後の設定は今後の発行分に使います。接頭辞を変更しても年ごとの採番をリセットしません。公開APIにはサービス名だけを反映し、会社情報や振込先を追加公開しません。

ここで編集できるのは発行者情報です。外部サービスの鍵、料金、通知文面や決済の有効化は扱いません。ローカル確認では既存の会社・銀行設定を変更せず、表示と同じ内容の保存で動作を確認できます。

## 初月請求書のローカル確認

既存データを残してスキーマを更新し、開発専用の請求書プレビューを有効にします。

```dotenv
DEV_INVOICE_PREVIEW=1
INVOICE_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium
```

PDF生成にはChromiumと日本語フォントが必要です。ローカルではインストール済みChromiumの実行ファイルを絶対パスで指定してください。APIコンテナにはChromiumとNoto CJKフォントを含めています。

```sh
pnpm db:migrate
pnpm dev:seed-billing
```

`dev:seed-billing` は開発モード・デモ認証プロジェクト・loopbackのAuth Emulatorと開発DBだけで使え、既存の会社・登録番号・銀行設定を上書きしません。APIを再起動後、管理者の申込詳細から審査を完了してください。プレビューには「開発用サンプル・お支払い不要」と明示し、未設定の登録番号・口座を架空の値で補いません。プレビュー発行時のメール通知予定は作成しません。

`/admin/invoices` と顧客本人の `/me/invoices` で請求書を確認できます。PDFはIDトークンをヘッダーに付けて取得し、公開URLやURL内のトークンは使いません。発行時点の宛先・会社情報・振込先・申込時の料金とクレジット・PDFを保存し、後からプランや設定が変わっても発行済み内容を変えません。発行・採番・状態変更・操作記録・PDF保存は同じトランザクションで確定します。

現段階の文書保管アダプターはローカル確認用のPostgreSQL保存です。設計上の本番保管先であるCloud Storageの接続は未実装で、本番では設定を埋めても発行とPDF取得を拒否します。正式な発行には公開済み法務文書、会社・登録番号・銀行設定と本番文書保管の準備が必要です。デプロイや実際のメール送信は行いません。

## 振込入金確認と契約成立のローカル確認

管理者で `/admin/bank-transfers` を開くと、初月の振込請求が並びます。通帳の入金日と請求に一致する金額を入力し、確認画面から記録します。開発用請求書では「実際の入金ではない」ことへの確認が必要です。プレビュー操作は上記の厳格なローカル環境だけで許可し、成立・クレジット付与の通知予定を作成しません。実際の銀行との通信やメール・LINE送信はありません。

入金日 `paid_on` は通帳の入金日、契約日 `anchor_date` は管理者が確認した日本時間の日付です。契約日から期間1を作り、発行済み請求書に保存したプラン・料金・クレジットを使って付与します。入金・支払い済み・契約成立・期間・付与・操作記録は同じトランザクションで確定し、同じ入力の再送で入金や付与を増やしません。

初月は発行日から支払期限までの入金で、契約が入金待ちの場合に限ります。未来の日付、過不足のある金額、期限後の初月入金、失効した契約の自動再開は拒否します。期限内に入金済みなら、管理者の確認が後日でも入金日を保存できます。期限後の入金や失効後の再開・返金の運用は設計上の確認事項です。

顧客本人は `/me` で契約日・今期の利用期間・残りクレジットを確認できます。入金待ちでは利用可能とは表示しません。対象期間の開始前・終了後のクレジットを今期の残りとして表示しません。請求書のPDFは発行時のまま保ち、画面の支払い状態だけが更新されます。

## 依頼と見積のローカル確認

管理者で `/admin/requests` を開き、利用中の契約を選んで依頼を登録します。見積ではクレジット数・目安日・作業内容・完了の状態を入力し、必要に応じて含まれないもの・準備事項を記載します。送り直した見積は新しい版になり、以前の内容を上書きしません。目安日は作業の予定であり、見積の了承期限ではありません。

顧客本人は `/me/requests` で最新の見積を確認し、内容を了承できます。今期のクレジットが不足する場合や、見積が差し替えられている場合は了承できません。了承とクレジット予約は同じトランザクションで保存し、二重操作や別依頼の同時了承で残高を超えて予約しません。今期の判定は日本時間の日付を使います。

管理者の依頼登録・見積送信は `Idempotency-Key` を付け、同じキーの再送で依頼や見積を増やしません。内容・操作・管理者が異なるキーの再利用は拒否します。管理者の操作記録・通知予定も同じトランザクションで確定します。開発用の契約では見積・作業開始の通知予定を作成せず、実際のメール・LINE送信は行いません。作業中の依頼は、管理者が完了日・実作業時間（分）・実績クレジットを別々に入力して完了できます。見積より実績が少ない場合は差額を戻し、実績が多い場合は警告を確認して実績を記録します。時間からクレジットを自動計算したり、超過分の金額を自動請求したりはしません。予約取消と消費は必ず予約元の期間に記録し、終了済みの期間の未使用差額はその期間で失効させます。完了の同一入力を再送しても消費を増やさず、完了結果・期間・時間・実績クレジットは顧客本人の画面でも確認できます。

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

ログイン後は `/api/v1/me/access` の契約状態に従い、審査・入金待ちなら `/me/waiting`、利用開始時の初回は `/me/welcome`、以後は `/me` に進みます。案内は表示しただけでは既読にせず、確認ボタンを押したときに一度だけ記録します。利用中の `/me` は本人の店舗名・担当者名・契約と残りクレジットを表示します。

`dev:seed-auth` はログイン確認用の契約なしアカウントを作るため、登録情報だけを表示します。業務フローは、申込フォームから作成し、管理者の審査・確認用入金記録を通したローカル顧客で確認してください。

承諾しない・失効したアカウントは終了メッセージとログアウトだけを表示し、APIも顧客データを返しません。終了した契約は、終了した日本日付の翌年同日まで請求書だけを閲覧できます（2/29の翌年は2/28まで）。匿名化後は閲覧できません。

web は起動時に public config API からサービス名を取得します。本番 web build には実プロジェクトの Firebase public config と HTTPS API URL を指定してください。開発用 demo project、fake API key、Auth Emulator は本番 build で拒否されます。Vite の `VITE_` 変数は bundle に含まれるため、server secret を設定しないでください。

## API と Auth Emulator

API は Firebase Admin SDK で ID token を検証し、`user_accounts` の UID・role・customer ID を認証情報として使います。顧客 API は認証された customer ID で必ず絞り、管理 API の namespace は DB role と ID token の第2要素の両方を要求します。公開configはサービス名と公開申込み条件・法務文書の参照を返し、当社の住所・登録番号・銀行情報などは含みません。

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

## KOMOJU Webhook受信箱

`POST /webhooks/komoju` は `X-Komoju-Signature` で原文バイト列のHMAC-SHA256を検証します。`.env` の `KOMOJU_WEBHOOK_SECRET` が未設定なら503を返し、イベントを受け付けません。秘密値はKOMOJU側の設定と一致させ、Gitには保存しないでください。外部へAPIリクエストを送る設定ではありません。

現段階では受信箱への永続化までを扱い、支払い済み・契約成立・クレジット付与には進めません。保存完了前に成功応答を返さず、DB障害は再送可能な503とします。本文のイベントIDで重複を排除し、配信ヘッダーのIDは重複判定に使いません。同じイベントIDで意味のある内容が変わった場合は元の記録を保持して競合を記録し、409を返します。隔離されたイベントは自動処理しません。

公式の決済データにはカード情報が含まれ得るため、受信JSONやカード情報を保存・ログ出力せず、イベントID・種類と、決済ID・状態・金額・通貨・請求番号の許可した項目だけを保存します。署名・秘密値・カード詳細・任意のmetadataは保存しません。外部KOMOJUとのテスト接続はまだ実施していません。

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
