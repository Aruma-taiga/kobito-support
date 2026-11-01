output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}
output "artifact_registry_repository" {
  value = google_artifact_registry_repository.api.name
}
