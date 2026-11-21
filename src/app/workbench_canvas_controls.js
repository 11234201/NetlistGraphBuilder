import { createLayoutSpacingController } from "../ui/layout_spacing_controller.js";
import { createTimingDisplayController } from "../ui/timing_display_controller.js";
import { createWheelGestureController } from "../ui/wheel_gesture_controller.js";
import { createModuleHierarchyController } from "../ui/module_hierarchy_controller.js";

import { createSchematicSelectionController } from "../ui/schematic_selection_controller.js";

export function createCanvasControls({ elements, readHierarchy, readCurrentModule, readOccurrence, selectModule,
  handleSingleNodeSelection, handleSingleNetSelection, readSpacing, commitLayoutSpacing, readTimingPolicy,
  commitTimingDisplayPolicy, applyPendingWheelGesture, commitViewHistory }) {
  const moduleHierarchyController = createModuleHierarchyController({
    container: elements.moduleHierarchyTree,
    panel: elements.moduleHierarchyMenu,
    filterInput: elements.moduleHierarchyFilter,
    getHierarchy: readHierarchy,
    getCurrentModuleName: readCurrentModule,
    getCurrentOccurrenceContext: readOccurrence,
    navigate: selectModule
  });
  const schematicSelectionController = createSchematicSelectionController({
    container: elements.mount,
    onNodeSelection: handleSingleNodeSelection,
    onNetSelection: handleSingleNetSelection
  });
  const layoutSpacingController = createLayoutSpacingController({
    elements,
    getSpacing: readSpacing,
    onCommit: commitLayoutSpacing
  });
  const timingDisplayController = createTimingDisplayController({
    elements: {
      metricSelect: elements.timingMetricSelect,
      thresholdInput: elements.timingSlackThresholdInput
    },
    getPolicy: readTimingPolicy,
    onCommit: commitTimingDisplayPolicy
  });
  const wheelGestureController = createWheelGestureController({
    canvas: elements.canvas,
    apply: applyPendingWheelGesture,
    onSettled: () => commitViewHistory({ label: "Viewport gesture" })
  });
  return { moduleHierarchyController, schematicSelectionController, layoutSpacingController, timingDisplayController, wheelGestureController };
}
