import { createUiPreferencesStore } from "./ui_preferences.js";
import { createWorkbenchViewportBridge } from "./workbench_viewport_bridge.js";
import { createWorkbenchShell } from "../ui/workbench_shell_controller.js";
import { createInspectorTabsController } from "../ui/inspector_tabs_controller.js";
import { createWorkbenchContextController } from "../ui/workbench_context_controller.js";

export function createWorkbenchUi({
  document, windowTarget, readViews, readContext, subscribe, singleViewSession,
  compareViewSessions, applyTransform, applyCompareTransforms, closeLog, onPreferenceError
}) {
  const viewport = createWorkbenchViewportBridge({
    readViews, singleViewSession, compareViewSessions, applyTransform, applyCompareTransforms, windowTarget
  });
  const preferences = createUiPreferencesStore({ windowTarget, onError: onPreferenceError });
  const shell = createWorkbenchShell({ document, windowTarget, preferences, onViewportResize: viewport.onViewportResize });
  const inspector = createInspectorTabsController({
    container: document.querySelector("#selectionDetails"),
    summaryButton: document.querySelector("#selectionSummaryButton"),
    copyText: (text) => windowTarget.navigator.clipboard.writeText(text),
    initialTab: shell.getPreferences().inspectorTab,
    onTabChange: shell.setInspectorTab
  });
  const context = createWorkbenchContextController({ document, windowTarget, readContext, closeLog });
  const unsubscribe = subscribe(context.scheduleRefresh);
  return Object.freeze({
    refresh: context.scheduleRefresh,
    refreshViewport: viewport.refresh,
    dispose() { unsubscribe(); context.dispose(); inspector.dispose(); shell.dispose(); viewport.dispose(); }
  });
}
