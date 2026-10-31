# メール送信（Resend）

`MAIL_PROVIDER=resend` を選ぶと通知ジョブが Resend Email API を利用します。起動環境に `RESEND_API_KEY` と `MAIL_FROM` を設定してください。API キーは環境変数または Secret Manager から注入し、リポジトリやログに保存しないでください。

1. Resend アカウントを作成し、送信に使うドメインを追加します。
2. Resend が表示する SPF・DKIM の DNS レコードをドメインの DNS に設定し、Resend 側で検証済みになるまで待ちます。
3. API キーを発行し、実行環境の `RESEND_API_KEY` に設定します。
4. 検証済みドメインのアドレスを `MAIL_FROM` に設定します。表示名を含める場合は `サービス名 <info@example.jp>` 形式です。

実際の送信は未確認です。ローカルのテストは fetch を置き換えて HTTP リクエストとエラー分類を確認します。
