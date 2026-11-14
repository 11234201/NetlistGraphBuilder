import { createSingleViewSessionBridge } from "../../src/app/single_view_session_bridge.js";
import { createCompareViewSessionBridge } from "../../src/app/compare_view_session_bridge.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";

// Controller lifecycle tests use the real state boundary even when the renderer
// is deliberately controlled to exercise failure, cancellation or stale work.
export function createTestViewBridges(state) {
  const viewSessions = createViewSessionStore();
  const options = { state, sessions: viewSessions, getDocumentId: () => state.document?.documentId || "test-document" };
  return { viewSessions, bindViewHistoryCallbacks: (options) => options,
    singleViewSession: createSingleViewSessionBridge(options),
    compareViewSessions: createCompareViewSessionBridge(options) };
}
