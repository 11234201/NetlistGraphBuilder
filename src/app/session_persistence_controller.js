import { createDebouncedPersistence } from "../application/debounced_persistence.js";
import { hasLoadedDesignSource } from "./appState.js";
import { createSessionSnapshot } from "./sessionState.js";
import { saveSessionStateResult } from "../persistence/session_storage.js";
import { errorMessage } from "../foundation/log_details.js";

// Saving a snapshot never changes the operation timeline or command metadata.
export function createSessionPersistenceController({ state, services, canPersist, readComparePath = () => null }) {
  const persistence = createDebouncedPersistence({
    readSnapshot: () => createSessionSnapshot(state, readComparePath()),
    save: saveSessionStateResult,
    canFlush: canPersist,
    onRecovered: () => services.logProcess("info", "persistence", "Session saving recovered", {
      operation: "save-session", moduleName: state.currentModule?.name
    }),
    onFailure: (error) => {
      services.logProcess("error", "persistence", `Session could not be saved: ${errorMessage(error)}`, {
        error, operation: "save-session", code: "session.save-failed", fileCount: state.sourceFiles?.length, moduleName: state.currentModule?.name
      });
      services.setStatus("Session save failed; changes may not survive a refresh");
    }
  });
  return Object.freeze({ persistSession() { if (hasLoadedDesignSource(state)) persistence.request(); } });
}

export const sessionPersistencePorts = Object.freeze({
  state: ["currentSource", "currentSourceLabel", "sourceFiles", "sourceIdentity", "document", "currentModule", "occurrenceContext", "compare",
    "showPath", "viewMode", "coneRootNodeId", "focusedRootNodeIds", "focusedRootRefs", "activeFocusedRootNodeId", "coneDepth",
    "faninDepth", "fanoutDepth", "transform", "showAliases", "layoutProviderId", "layoutFallbackFromProviderId",
    "layoutPolicy", "presentationPolicy", "useFanoutHubs", "graphOverrides", "timing", "timingDisplayPolicy", "searchQuery"],
  elements: [],
  services: ["logProcess", "setStatus"]
});
