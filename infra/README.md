# インフラ

このディレクトリには、まだクラウド用の設定や Terraform を置いていません。PR1 で用意したのはローカル用の PostgreSQL 16 と Firebase Auth Emulator のみで、設定はリポジトリ直下の `docker-compose.yml`、Emulator 用イメージは `docker/firebase-auth/` にあります。

GCP / Cloudflare の構築、本番用の秘密情報、KOMOJU、LINE、メール送信、デプロイはこの段階の対象外です。後続 PR で設計書に沿ってインフラを加える際は、この README を更新してください。
