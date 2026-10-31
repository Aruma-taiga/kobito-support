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
variable "api_image" {
  type = string
}
variable "database_password_secret_version" {
  description = "事前登録した DB パスワード Secret のバージョン番号"
  type        = string
}
variable "scheduler_paused" {
  description = "外部連携の確認完了まで Scheduler を停止しておく"
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
