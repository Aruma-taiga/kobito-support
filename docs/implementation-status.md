# 実装と検証の進捗

設計の正本は `system-design-v1.md`。このファイルは作業状況の記録であり、設計書を置き換えません。

ユーザー指示：残りの実装も完了まで継続。安価なモデルのサブエージェントを使い、金額・期間・状態はTDDで検証。小さなPRごとにCI通過を確認する。マージ・デプロイ・実決済・実通知は別途の明示的な授権まで実行しない。

| 段階 | 状態・残作業 |
|---|---|
| 土台・DB・共通計算・認証・画面骨組み | PR #1〜#5、CI成功 |
| 申込み・同意保存 | PR #6、CI成功。ローカル草案参照と実公開設定を区別 |
| 管理者2段階認証・審査 | PR #7、CI成功。Auth EmulatorのSMS第2要素で通し確認。本番TOTPの通し確認は未実施 |
| 初月請求書・PDF | PR #8、CI成功。実PDF・非rootコンテナ・顧客/管理者の取得を確認 |
| 振込入金確認・契約成立 | PR #9、CI成功。単体236件・DB49件。実画面で期間と付与を確認 |
| KOMOJU | Webhook署名検証・安全な受信箱を実装（PR作成・CI確認中）。単体247件・DB51件とHTTP通信で検証。支払画面・カード定期課金・コンビニ・入金反映・失敗通知が残る |
| 毎月の処理 | 期間作成・請求・付与/失効・期限/失敗通知の予定作成と配信が残る |
| 依頼・見積・個別プラン見積り | 管理登録・版管理・顧客了承・予約/消費・個別プラン承諾が残る |
| LINE | 連携ログイン・LIFF・通知・リッチメニュー設定の準備が残る |
| パートナー・解約・削除 | 報酬・解約/終了・匿名化・保存期限の処理と画面が残る |
| インフラ・本番切替 | Terraform・外部設定・監視/バックアップ/復元・通し確認が残る。デプロイ未実施 |

## 外部準備と確認事項

- 会社情報・インボイス登録番号・銀行口座・公開法務文書の確定が必要。値を仮定せず、未設定では正式発行/受付を止める。
- 本番PDFは設計上Cloud Storage。現状はローカル確認用PostgreSQL保管で、本番の発行/取得は未対応として拒否する。
- KOMOJUのテスト資格情報、請求番号とカード定期課金の対応、月末・自動再試行、コンビニ発行手数料の確定とプロバイダー上の試作が必要。
- 公式Webhookの決済オブジェクトにはカード有効期限などが含まれ得る。原文JSONを永続化する設計記載より、カード情報禁止の明示指示を優先する。署名は原文バイト列で確認し、保存は非機密項目のallowlist方式とする。この差分は該当PRにも記載する。
- 初月期限後の入金と、失効済み申込みへの期限内入金の後日確認について、契約を復活させる運用は未確定。現在は自動成立を拒否する。
- LINE・メール送信サービス・GCP・Cloudflareのアカウント/設定と本番ドメインの準備状況は未確認。認証情報はコミットしない。

## ローカル確認データ

既存の審査結果は戻さない。架空の顧客・請求書で確認し、資格情報はGit管理外のローカルファイルに保存する。

- `KS-2026-00001`：確認用入金記録済み。期間2026-10-26〜11-25、ライト1クレジット。
- `KS-2026-00002`：手動確認用に未払いのまま保持。銀行振込の入金確認画面から確認可能。

開発サーバー・ポート・ブラウザセッションは親エージェントが所有/調整し、テスト用サーバーで置き換えない。

## 外部仕様の確認記録（KOMOJU）

- Webhookは `X-Komoju-Signature` のHMAC-SHA256で原文バイト列を検証する。配信IDと本文のイベントIDを混同しない。[公式Webhook仕様](https://docs.komoju.com/en/docs/introduction/core-concepts/webhooks)
- Hosted PageのSessionは請求番号を `payment_data.external_order_num` で渡せる。Sessionの有効期限とコンビニ支払番号の有効期限は別。[Hosted Page](https://docs.komoju.com/en/docs/integration-guides/web-integrations/hosted-page/standard-mode)、[Session作成](https://ja.doc.komoju.com/reference/createsession-1)、[コンビニ期限](https://help.komoju.com/hc/en-us/articles/4747480397982-How-to-Change-the-Payment-Expiry-Date-for-Konbini)
- Hosted Sessionの `customer_payment` とSubscription APIの組合せが公式仕様上の候補。初回決済後の二重課金防止、次回の課金起点・月末・09:00の扱い、生成されるイベントの対応は加盟店テストで確認するまで有効化しない。カード情報や決済方法トークンを当アプリで受け取るフォームは作らない。[Customer mode](https://docs.komoju.com/en/docs/integration-guides/web-integrations/hosted-page/customer-mode)、[Subscription作成](https://ja.doc.komoju.com/reference/createsubscription-1)
- 外向きPOSTの `X-KOMOJU-IDEMPOTENCY` とWebhookイベントの重複排除は別の仕組み。[公式冪等性仕様](https://docs.komoju.com/en/docs/introduction/core-concepts/idempotent-requests)

上記は公開仕様の確認であり、加盟店アカウントでの動作検証・本番利用の承認を意味しない。
