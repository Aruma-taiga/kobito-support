locals {
  services = toset([
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "identitytoolkit.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "cloudscheduler.googleapis.com",
    "monitoring.googleapis.com"
  ])
  app_secrets = toset([
    "DATABASE_URL",
    "KOMOJU_SECRET_KEY",
    "KOMOJU_WEBHOOK_SECRET",
    "RESEND_API_KEY",
    "MAIL_FROM"
  ])
  pdf_storage_env = var.pdf_storage_gcs_enabled ? {
    PDF_STORAGE = "gcs"
    PDF_BUCKET  = google_storage_bucket.invoices.name
  } : {}
  labels = {
    app         = "kobito-support"
    environment = "prod"
  }
}

resource "google_project_service" "enabled" {
  for_each           = local.services
  project            = var.gcp_project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "api" {
  project       = var.gcp_project_id
  location      = var.region
  repository_id = "${var.name_prefix}-containers"
  description   = "API container images"
  format        = "DOCKER"
  depends_on    = [google_project_service.enabled]
}

resource "google_service_account" "run" {
  project      = var.gcp_project_id
  account_id   = "${var.name_prefix}-run"
  display_name = "Kobito Support Cloud Run"
}

resource "google_service_account" "scheduler" {
  project      = var.gcp_project_id
  account_id   = "${var.name_prefix}-scheduler"
  display_name = "Kobito Support Scheduler"
}

resource "google_project_iam_member" "run_cloudsql" {
  project = var.gcp_project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.app_secrets
  project   = var.gcp_project_id
  secret_id = "${var.name_prefix}-${lower(replace(each.key, "_", "-"))}"
  replication {
    auto {}
  }
  labels = local.labels
}

resource "google_secret_manager_secret" "database_password" {
  project   = var.gcp_project_id
  secret_id = "${var.name_prefix}-database-password"
  replication {
    auto {}
  }
  labels = local.labels
}

resource "google_secret_manager_secret_iam_member" "run_read" {
  for_each  = google_secret_manager_secret.app
  project   = var.gcp_project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "run_db_password" {
  project   = var.gcp_project_id
  secret_id = google_secret_manager_secret.database_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

data "google_secret_manager_secret_version" "database_password" {
  project    = var.gcp_project_id
  secret     = google_secret_manager_secret.database_password.secret_id
  version    = var.database_password_secret_version
  depends_on = [google_secret_manager_secret.database_password]
}

resource "google_sql_database_instance" "main" {
  project             = var.gcp_project_id
  name                = "${var.name_prefix}-postgres"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = true
  settings {
    tier              = "db-f1-micro"
    availability_type = "ZONAL"
    disk_autoresize   = true
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }
    ip_configuration {
      ipv4_enabled = true
    }
    user_labels = local.labels
  }
  depends_on = [google_project_service.enabled]
}

resource "google_sql_database" "app" {
  project  = var.gcp_project_id
  name     = "kobito_support"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  project  = var.gcp_project_id
  name     = "kobito_app"
  instance = google_sql_database_instance.main.name
  password = data.google_secret_manager_secret_version.database_password.secret_data
}

resource "google_cloud_run_v2_service" "api" {
  project             = var.gcp_project_id
  name                = "${var.name_prefix}-api"
  location            = var.region
  deletion_protection = true
  labels              = local.labels
  template {
    service_account = google_service_account.run.email
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }
    containers {
      # Chromium で請求書PDFを生成するため、既定（512MiB）では足りない可能性が高い。実測のうえ調整する。
      resources {
        limits = {
          cpu    = "1"
          memory = var.pdf_render_memory
        }
      }
      image = var.api_image
      ports {
        container_port = 8080
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      dynamic "env" {
        for_each = local.pdf_storage_env
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name  = "PORT"
        value = "8080"
      }
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.gcp_project_id
      }
      env {
        name  = "WEB_ORIGIN"
        value = "https://app.${var.domain_name}"
      }
      env {
        name  = "INVOICE_PREFIX"
        value = var.invoice_prefix
      }
      env {
        name  = "SERVICE_NAME"
        value = var.service_name
      }
      env {
        name  = "COMPANY_NAME"
        value = var.company_name
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["DATABASE_URL"].secret_id
            version = "latest"
          }
        }
      }
      dynamic "env" {
        for_each = var.komoju_enabled ? [1] : []
        content {
          name = "KOMOJU_SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["KOMOJU_SECRET_KEY"].secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.komoju_enabled ? [1] : []
        content {
          name = "KOMOJU_WEBHOOK_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["KOMOJU_WEBHOOK_SECRET"].secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.mail_enabled ? [1] : []
        content {
          name = "RESEND_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["RESEND_API_KEY"].secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.mail_enabled ? [1] : []
        content {
          name = "MAIL_FROM"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["MAIL_FROM"].secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.mail_enabled ? [1] : []
        content {
          name  = "MAIL_PROVIDER"
          value = "resend"
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
  }
  depends_on = [google_project_service.enabled, google_storage_bucket_iam_member.run_pdf_objects]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.gcp_project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_storage_bucket" "invoices" {
  project                     = var.gcp_project_id
  name                        = "${var.gcp_project_id}-${var.name_prefix}-invoices"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  lifecycle_rule {
    condition {
      age = 2555
    }
    action {
      type = "Delete"
    }
  }
}

# PDF 保存・取得だけを許可する。上書き・削除・一覧・公開権限は付与しない。
resource "google_project_iam_custom_role" "pdf_objects" {
  count       = var.pdf_storage_gcs_enabled ? 1 : 0
  project     = var.gcp_project_id
  role_id     = "${replace(var.name_prefix, "-", "_")}_pdf_objects"
  title       = "Invoice PDF object access"
  description = "Create and read invoice PDF objects in the private invoice bucket"
  permissions = ["storage.objects.create", "storage.objects.get"]
  depends_on  = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "run_pdf_objects" {
  count  = var.pdf_storage_gcs_enabled ? 1 : 0
  bucket = google_storage_bucket.invoices.name
  role   = google_project_iam_custom_role.pdf_objects[0].name
  member = "serviceAccount:${google_service_account.run.email}"
}

resource "google_cloud_run_v2_job" "daily" {
  project  = var.gcp_project_id
  name     = "${var.name_prefix}-daily"
  location = var.region
  template {
    template {
      service_account = google_service_account.run.email
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }
      containers {
        # Chromium で請求書PDFを生成するため、既定（512MiB）では足りない可能性が高い。実測のうえ調整する。
        resources {
          limits = {
            cpu    = "1"
            memory = var.pdf_render_memory
          }
        }
        image   = var.api_image
        command = ["node"]
        args    = ["dist/jobs/daily-billing-script.js"]
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        dynamic "env" {
          for_each = local.pdf_storage_env
          content {
            name  = env.key
            value = env.value
          }
        }
        env {
          name  = "FIREBASE_PROJECT_ID"
          value = var.gcp_project_id
        }
        env {
          name  = "WEB_ORIGIN"
          value = "https://app.${var.domain_name}"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["DATABASE_URL"].secret_id
              version = "latest"
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }
  depends_on = [google_storage_bucket_iam_member.run_pdf_objects]
}

resource "google_cloud_run_v2_job" "notifications" {
  project  = var.gcp_project_id
  name     = "${var.name_prefix}-notifications"
  location = var.region
  template {
    template {
      service_account = google_service_account.run.email
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }
      containers {
        image   = var.api_image
        command = ["node"]
        args    = ["dist/jobs/notifications-script.js"]
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        dynamic "env" {
          for_each = local.pdf_storage_env
          content {
            name  = env.key
            value = env.value
          }
        }
        env {
          name  = "FIREBASE_PROJECT_ID"
          value = var.gcp_project_id
        }
        env {
          name  = "WEB_ORIGIN"
          value = "https://app.${var.domain_name}"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["DATABASE_URL"].secret_id
              version = "latest"
            }
          }
        }
        dynamic "env" {
          for_each = var.mail_enabled ? [1] : []
          content {
            name = "RESEND_API_KEY"
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.app["RESEND_API_KEY"].secret_id
                version = "latest"
              }
            }
          }
        }
        dynamic "env" {
          for_each = var.mail_enabled ? [1] : []
          content {
            name  = "MAIL_PROVIDER"
            value = "resend"
          }
        }
        dynamic "env" {
          for_each = var.mail_enabled ? [1] : []
          content {
            name = "MAIL_FROM"
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.app["MAIL_FROM"].secret_id
                version = "latest"
              }
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }
  depends_on = [google_storage_bucket_iam_member.run_pdf_objects]
}

resource "google_cloud_run_v2_job" "retention" {
  project  = var.gcp_project_id
  name     = "${var.name_prefix}-retention"
  location = var.region
  template {
    template {
      service_account = google_service_account.run.email
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }
      containers {
        image   = var.api_image
        command = ["node"]
        args    = ["dist/jobs/retention-script.js"]
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        dynamic "env" {
          for_each = local.pdf_storage_env
          content {
            name  = env.key
            value = env.value
          }
        }
        env {
          name  = "FIREBASE_PROJECT_ID"
          value = var.gcp_project_id
        }
        env {
          name  = "WEB_ORIGIN"
          value = "https://app.${var.domain_name}"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["DATABASE_URL"].secret_id
              version = "latest"
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }
  depends_on = [google_storage_bucket_iam_member.run_pdf_objects]
}

resource "google_project_iam_member" "scheduler_run_jobs" {
  project = var.gcp_project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "jobs" {
  for_each = {
    daily         = { schedule = "0 6 * * *", paused = var.scheduler_paused }
    notifications = { schedule = "*/5 * * * *", paused = var.scheduler_paused }
    retention     = { schedule = "30 6 * * *", paused = var.retention_scheduler_paused }
  }
  project     = var.gcp_project_id
  region      = var.region
  name        = "${var.name_prefix}-${each.key}"
  description = "Starts the ${each.key} Cloud Run Job"
  schedule    = each.value.schedule
  time_zone   = "Asia/Tokyo"
  paused      = each.value.paused
  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.gcp_project_id}/jobs/${var.name_prefix}-${each.key}:run"
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }
  depends_on = [google_project_service.enabled]
}

resource "google_monitoring_alert_policy" "run_5xx" {
  project      = var.gcp_project_id
  display_name = "${var.name_prefix} Cloud Run 5xx"
  combiner     = "OR"
  conditions {
    display_name = "Cloud Run 5xx responses"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.label.response_code_class=\"5xx\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }
  documentation {
    content = "Cloud Run API is returning 5xx responses."
  }
}

resource "google_monitoring_alert_policy" "sql_connections" {
  project      = var.gcp_project_id
  display_name = "${var.name_prefix} Cloud SQL connections"
  combiner     = "OR"
  conditions {
    display_name = "Cloud SQL connections above starter threshold"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/postgresql/num_backends\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 80
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }
  documentation {
    content = "Review Cloud SQL connection usage and capacity."
  }
}

resource "cloudflare_pages_project" "web" {
  account_id        = var.cloudflare_account_id
  name              = "${var.name_prefix}-web"
  production_branch = "main"
  build_config {
    build_command   = "pnpm --filter @kobito/shared build && pnpm --filter @kobito/web build"
    destination_dir = "apps/web/dist"
    root_dir        = "/"
  }
  source {
    type = "github"
    config {
      owner                         = "YOUR_GITHUB_ACCOUNT"
      repo_name                     = "YOUR_REPOSITORY"
      production_branch             = "main"
      deployments_enabled           = false
      pr_comments_enabled           = false
      preview_deployment_setting    = "none"
      production_deployment_enabled = false
    }
  }
  deployment_configs {
    production {
      environment_variables = {
        VITE_FIREBASE_API_KEY     = var.web_firebase_api_key
        VITE_FIREBASE_AUTH_DOMAIN = var.web_firebase_auth_domain
        VITE_FIREBASE_PROJECT_ID  = var.web_firebase_project_id
        VITE_FIREBASE_APP_ID      = var.web_firebase_app_id
        VITE_API_BASE_URL         = "https://api.${var.domain_name}"
      }
    }
  }
}

resource "cloudflare_pages_domain" "app" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.web.name
  domain       = "app.${var.domain_name}"
}

resource "cloudflare_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = "api"
  type    = "CNAME"
  content = split("/", trimprefix(google_cloud_run_v2_service.api.uri, "https://"))[0]
  proxied = false
  ttl     = 1
}

resource "cloudflare_record" "resend_spf" {
  zone_id = var.cloudflare_zone_id
  name    = var.mail_from_domain
  type    = "TXT"
  content = var.resend_spf_value
  ttl     = 1
}

resource "cloudflare_record" "resend_dkim" {
  zone_id = var.cloudflare_zone_id
  name    = var.resend_dkim_name
  type    = "TXT"
  content = var.resend_dkim_value
  ttl     = 1
}
