# コビトサポート

TypeScript の基幹システムです。設計と作業順は `docs/` を参照してください。

## 現在の段階

PR1 は開発基盤のみです。pnpm workspace（web / api / shared）、環境設定の検証、PostgreSQL 16 と Firebase Auth Emulator のローカル環境、lint・型検査・テスト・SQL 検証 CI を用意しています。申込画面、API、認証フロー、業務処理はまだありません。`pnpm dev` でアプリを起動する段階ではありません。

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

`.tools/` は Git 管理外です。Node.js 22.x 上で pnpm 10.22.0 が使われることを確認してください。

## ローカル依存サービス

空欄の `.env.example` を実行設定として使うことはできません。API 起動時には DB URL、Firebase project ID、web origin が必要です。現在は API 実装前ですが、後続の開発用値は次のとおりです。

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://kobito:kobito@127.0.0.1:5432/kobito_support
FIREBASE_PROJECT_ID=demo-kobito-support
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
WEB_ORIGIN=http://localhost:5173
INVOICE_PREFIX=KS
```

サービス名、会社名、登録番号、振込口座は未設定のままにしてください。後続ステージで公開設定 API を実装した後は settings テーブルを値の正とします。API はこの PR では値を読み込むだけで、認証や業務用途に使いません。

```sh
docker compose up --build -d
docker compose ps
```

PostgreSQL は `127.0.0.1:5432`、Auth Emulator は `127.0.0.1:9099` のみに公開します。5432 が使用中なら `POSTGRES_PORT=55433 docker compose up --build -d` のように変更できます。両方の health が `healthy` になれば利用可能です。DB schema は CI で空 DB に対して検証します。ローカル DB はこの段階では空で、migration runner は後続 PR で追加します。volume を消すとローカル DB の内容が消えます。

```sh
docker compose down
# DB を初期化し直す場合だけ:
docker compose down -v
```

## 検査

```sh
pnpm lint
pnpm typecheck
pnpm test
```

CI は Pull Request ごとに上記を実行し、PostgreSQL 16 の空 DB に `docs/schema-v1.sql` を適用します。現在の段階では migration runner はまだありません。
