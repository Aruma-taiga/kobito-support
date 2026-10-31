terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.40"
    }
  }

  # 初回はローカル state。共有運用に移る際に GCS バックエンドを設定する。
  # backend "gcs" {
  #   bucket = var.terraform_state_bucket
  #   prefix = "kobito-support/prod"
  # }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.region
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
