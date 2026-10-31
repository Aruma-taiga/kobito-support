# Terraform 構成案

GCP の本番相当環境（東京 `asia-northeast1`）と Cloudflare Pages/DNS の最小構成です。**このコードは作成段階の草案で、`plan` / `apply` や本番環境への接続は行っていません。** リソース名やドメインは変数化し、`terraform.tfvars.example` に実在値を置いていません。

## 構成

- `versions.tf`: Terraform / Google / Cloudflare provider の制約、GCS backend のコメントアウト雛形。
- `variables.tf`, `terraform.tfvars.example`: 環境固有値。
- `main.tf`: API 有効化、Artifact Registry、実行・Scheduler 用サービスアカウント、Cloud SQL、Secret Manager、Cloud Run API/Jobs、Scheduler、非公開 GCS、Cloudflare Pages/DNS、監視アラート。
- `outputs.tf`: API URL、DB 接続名、Artifact Registry。

Cloud Run API は Webhook を受けるため未認証呼び出しを許可します。顧客認証・管理者の二段階認証は API が検証します。Cloud SQL は PostgreSQL 16、東京の最小 `db-f1-micro`、自動バックアップ/PITR、削除保護を設定しています。Cloud Run の DB 接続は Cloud SQL 接続機能を使います。

Cloud Storage は請求書 PDF 用の非公開バケットと 2,555 日（約7年）のライフサイクル枠です。既定では PDF は PostgreSQL に保存し、バケットの作成だけでは保存先は切り替わりません。`pdf_storage_gcs_enabled = true` を明示した場合だけ、Cloud Run API と全 Jobs に `PDF_STORAGE=gcs` と `PDF_BUCKET=<この構成の invoices バケット名>` を渡します。同時に、実行サービスアカウントへ `storage.objects.create` / `storage.objects.get` だけを含むカスタムロールをこのバケットに限定して付与します。オブジェクトの一覧・上書き・削除・公開や署名 URL 発行のための権限は付与しません。認証付き API 経由で取得する構成です。既存 PostgreSQL 保存 PDF の移行は行いません。

## 事前に人が行うこと

1. GCP プロジェクトを作り、請求先を関連付ける。Cloud SQL・Cloud Run・Scheduler・Identity Platform の利用条件と予算アラートを確認する。
2. Cloudflare アカウントと対象 Zone を用意し、Pages・DNS に必要な範囲だけの API Token を発行する。値は tfvars に直書きせず、環境変数等から渡す。
3. ドメインの正式な綴りを確認する。設計書には `cingulata.jp` と記載がありますが確認待ちのため、この草案では決め打ちしていません。
4. KOMOJU 本番審査・加盟店表示名の変更、Resend の本番アカウントと送信ドメインの SPF/DKIM 検証を行う。DNS 値は各サービスが発行した値を変数で渡す。
5. DB パスワード用 Secret (`<prefix>-database-password`) を Secret Manager に作成し、値を安全な手段で登録する。Terraform の管理対象に取り込んでから、バージョン番号を `database_password_secret_version` に渡す。Terraform の SQL User に設定するため state にパスワードが含まれる可能性がある。GCS backend を有効化する前に state を厳格に保護し、アクセス権を限定する。
6. アプリ Secret の枠は Terraform が作りますが、値・バージョンは作りません。Cloud Run を起動する前に `DATABASE_URL`、`KOMOJU_WEBHOOK_SECRET`、`RESEND_API_KEY`、`MAIL_FROM` などを登録します。`DATABASE_URL` は Cloud SQL Unix socket (`/cloudsql/<接続名>`) に接続する形式にします。`KOMOJU_SECRET_KEY` と `KOMOJU_WEBHOOK_SECRET` は、変数 `komoju_enabled`（既定 false）が false の間は Cloud Run に渡しません。**この間はカード決済が無効**です（Cloud Run は、版のない Secret を参照すると起動に失敗するため、版を作らないだけでは無効になりません）。カードを有効にする承認後に、Secret の版を登録してから `komoju_enabled = true` にしてください。メールも同様に `mail_enabled`（既定 false）で、`RESEND_API_KEY`・`MAIL_FROM`・`MAIL_PROVIDER` の受け渡しを切り替えます。
7. Identity Platform を有効化し、Firebase/Identity Platform のプロジェクトを GCP プロジェクトに揃える。メール＋パスワードのサインインを有効にし、管理者アカウントを作成する。管理者には TOTP（二段階認証）を必須化し、API が検証する二段階認証証拠の運用を確認する。Terraform の API 有効化だけでは Identity Platform のテナント・ログイン方式・管理者 MFA は完了しません。
8. Cloudflare Pages の Git 連携先・アカウント・Zone、Firebase の Web アプリ値を確認する。Pages のデプロイ設定は誤デプロイ防止のため無効です。Web ビルドが `VITE_*` をビルド時に必要とするので、デプロイ手順側にも同じ値を設定します。

## 初回有効化の順序

1. GCP/Cloudflare、請求、権限、Identity Platform、Secret Manager の前提を整える。
2. DB パスワード Secret を用意し、Cloud SQL と DB/User を作る。マイグレーションは別途、承認済みの手順で実行する。
3. Artifact Registry に Dockerfile から API イメージをビルド・登録する。Terraform に `api_image` を渡す。
4. アプリ Secret の必要な版を登録してから Cloud Run API を起動し、ヘルスチェック・認証・Webhook の疎通を確認する。
5. Web をビルド/Pages へ接続し、API CORS と Firebase 設定を確認する。
6. メール送信、決済、バックアップ復元、各 Job の dry run 相当の手順を検証する。最後に `scheduler_paused=false` として Scheduler を有効化する。初期値は `true` です。

### Job の実行コマンドと制約

`apps/api/package.json` の `job:*` は `tsx` を呼びますが、`apps/api/Dockerfile` は `pnpm deploy --prod` で本番依存だけを配置するため、`tsx` コマンドは本番イメージにありません。このため Cloud Run Jobs は TypeScript ビルド出力 `node dist/jobs/daily-billing-script.js`、`notifications-script.js`、`retention-script.js` を直接実行する設定です。Dockerfile のビルド出力パスと実際のイメージ内で各ジョブの起動を確認するまでは、稼働可能とみなさないでください。Scheduler の起動リクエストは Google API の OAuth を使います（Cloud Run の HTTP サービス向け OIDC ではなく Cloud Run Jobs API の認証方式）。

`job:retention` は個人情報の匿名化を行う本番データ変更処理です。実行前に削除対象・保持期間・監査を確認し、初回運用手順を承認してください。現在の処理は Firebase アカウント自体を削除しません。

## PDF の GCS 保存を有効にする前

`pdf_storage_gcs_enabled` の既定値は `false` です。切り替え前に、GCS 対応を含む API イメージ、バケットの保持方針、実行サービスアカウントの ADC、PDF の生成・取得・重複作成時の挙動、既存 PostgreSQL 保存 PDF の取得を実環境で確認してください。Cloud Run と Jobs は同じサービスアカウントを使い、サービスアカウント鍵は配布しません。外部サービス設定・本番有効化には別途承認が必要です。Terraform の `plan` / `apply` や GCS 接続検証はこの変更では実施していません。

```hcl
# 承認と実環境検証の完了後のみ有効にする
pdf_storage_gcs_enabled = true
```

## カード決済を有効にする前

W1 のテストモード確認では、定期課金は作成時に初回課金され、定期課金由来の `payment.captured` には請求番号が入りません。現在の実装は請求書ごとの単発支払いリンクで、定期課金は未採用です。月末（29〜31日）の課金日と、失敗後の自動再試行は未確認です。決済の紐付け・月末周期・再試行方針・本番の Webhook と返金/取消運用を確定し、テストしてから、Secret の版を登録して `komoju_enabled = true` にしてください。有効にするとアプリのカード機能が有効になります。

## 未実装・未検証

- 請求書 PDF の GCS 保存の実環境検証と本番有効化。設定は既定で無効です。
- Resend によるメールの実送信、SPF/DKIM の実検証。
- `job:retention` からの Firebase アカウント削除。
- Docker イメージ内での Job 起動、Terraform `fmt` / `validate`、GCP/Cloudflare の実リソース検証。
- Cloud SQL の復元訓練・監視通知先。アラートは最小のポリシー枠で、通知チャンネルは別途設定が必要です。

Terraform CLI はこの作業環境にないため、構文検証していません。実環境を変更する前に、Docker の公式 Terraform イメージなどで `terraform fmt -check` と `terraform validate` を実施し、Terraform/provider の対応属性を確認してください。
