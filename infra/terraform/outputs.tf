output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}
output "database_connection_name" {
  value = google_sql_database_instance.main.connection_name
}
output "artifact_registry_repository" {
  value = google_artifact_registry_repository.api.name
}
