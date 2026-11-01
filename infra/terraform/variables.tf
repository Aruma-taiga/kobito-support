variable "gcp_project_id" {
  type = string
}
variable "region" {
  type    = string
  default = "asia-northeast1"
}
variable "name_prefix" {
  type    = string
  default = "kobito-support"
}
variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}
variable "cloudflare_zone_id" {
  type = string
}
variable "cloudflare_account_id" {
  type = string
}
variable "domain_name" {
  type = string
}
variable "web_hostname" {
  description = "画面のホスト名（完全な名前）。空なら app.<domain_name>。例：dev-kobito-support.example.invalid"
  type        = string
  default     = ""
}
variable "api_hostname" {
  description = "API のホスト名（完全な名前）。空なら api.<domain_name>。Cloudflare の無料の証明書は 1 段階のサブドメインのみ対象"
  type        = string
  default     = ""
}
variable "api_image" {
  type = string
}
variable "migrate_image" {
  description = "docker build --target migrate で作成した DB 初期化用イメージ"
  type        = string
}
variable "scheduler_paused" {
  description = "daily（請求）と notifications（通知）の Scheduler を停止しておく。外部連携の確認完了まで true。匿名化（retention）は retention_scheduler_paused で別に制御する"
  type        = bool
  default     = true
}
variable "retention_scheduler_paused" {
  description = "retention（個人情報の匿名化）の Scheduler を停止しておく。本番データを変更する処理のため、初回運用手順の承認まで true のままにする。scheduler_paused とは独立"
  type        = bool
  default     = true
}
variable "web_firebase_api_key" {
  type      = string
  sensitive = true
}
variable "web_firebase_auth_domain" {
  type = string
}
variable "web_firebase_project_id" {
  type = string
}
variable "web_firebase_app_id" {
  type      = string
  sensitive = true
}
variable "resend_spf_value" {
  type      = string
  sensitive = true
}
variable "resend_dkim_name" {
  type = string
}
variable "resend_dkim_value" {
  type      = string
  sensitive = true
}
variable "mail_from_domain" {
  type = string
}
variable "service_name" {
  type    = string
  default = ""
}
variable "company_name" {
  type    = string
  default = ""
}
variable "invoice_prefix" {
  type    = string
  default = "KS"
}

variable "terraform_state_bucket" {
  description = "コメントアウトした GCS backend のバケット名"
  type        = string
  default     = ""
}

variable "komoju_enabled" {
  description = "true にすると API と Webhook に KOMOJU のシークレットを渡し、カード決済が有効になる。シークレットに版が登録されていること、README の確認事項を済ませてから true にする。"
  type        = bool
  default     = false
}

variable "mail_enabled" {
  description = "true にするとメール送信（Resend）のシークレットを渡す。Resend のドメイン検証とシークレットの登録後に true にする。"
  type        = bool
  default     = false
}

variable "pdf_storage_gcs_enabled" {
  description = "true にすると API と Jobs の PDF 保存先を既存の非公開請求書バケットに切り替える。本番有効化の承認と GCS の実環境検証後に有効にする。"
  type        = bool
  default     = false
}

variable "pdf_render_memory" {
  description = "請求書PDF（Chromium）を生成する Cloud Run（API と日次ジョブ）のメモリ。既定の 512MiB では足りない可能性が高いので 2Gi。実測のうえ調整する。"
  type        = string
  default     = "2Gi"
}
