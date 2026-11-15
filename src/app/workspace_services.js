import { createDocumentStore } from "../application/document_store.js";
import { createViewSessionStore } from "../application/view_session_store.js";
import { createArtifactStore } from "../application/artifact_store.js";
import { createJobCoordinator } from "../application/job_coordinator.js";
import { createWorkspaceExecution } from "../application/workspace_execution.js";
import { createImportRequests } from "../application/import_requests.js";

export function createWorkspaceServices() {
  const documents = createDocumentStore();
  const viewSessions = createViewSessionStore();
  const workspaceArtifacts = createArtifactStore();
  const workspaceJobs = createJobCoordinator({ documents, sessions: viewSessions, artifacts: workspaceArtifacts });
  return { documents, viewSessions, workspaceArtifacts, workspaceJobs, importRequests: createImportRequests(),
    workspaceExecution: createWorkspaceExecution({ jobs: workspaceJobs }) };
}
