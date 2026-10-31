# インフラ

クラウド構成のコードと運用メモを置くディレクトリです。Terraform の GCP・Cloudflare 構成は [`terraform/README.md`](terraform/README.md) を参照してください。

ローカル開発ではリポジトリ直下の `docker-compose.yml` で PostgreSQL 16 と Firebase Auth Emulator を起動します。クラウドへの適用・デプロイは構成のレビューと各サービスの準備が済んでから行います。
