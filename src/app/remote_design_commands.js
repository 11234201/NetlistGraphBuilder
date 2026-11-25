import {resolveNetlistObject, invalid} from "./remote_object_queries.js";
import {getTimingBadgeChoices, getNormalizedNodePins, isTimingBadgePosition, updateTimingBadgeChoices} from "../ui/timingPanel.js";
import {missingCellTimingDetails} from "../timing/timing_diagnostics.js";

const compareSyncSettings = new Map([
  ["compare sync-viewport", "syncViewport"],
  ["compare sync-roots", "syncRoots"],
  ["compare sync-selection", "syncSelection"]
]);

export function createRemoteDesignCommands({readTimingView, updateBadges, settings, actions, getElements, completed, logTiming}) {
  function timingObject(job) {
    const view = readTimingView(job.opts.side);
    const object = resolveNetlistObject(view, job.args[0]);
    const node = view.graph?.nodes.find(item => item.id === object.id) || object.node;
    if (!node) throw invalid("OBJECT_NOT_FOUND","Choose a node or port with timing information");
    const key = node.ref?.instance || node.ref?.name || node.label;
    if (job.name === "timing log-details") {
      const details = missingCellTimingDetails(node,view.graph?.timingSummary) ||
        {instance:key, pins:getNormalizedNodePins(node), moduleName:view.moduleName};
      logTiming(view,details,job);
      return details;
    }
    if (!node.timing) throw invalid("TIMING_UNAVAILABLE","This object has no timing annotations");
    const [,pin,metric,enabled] = job.args;
    if (job.name === "timing badge-position" && !isTimingBadgePosition(pin))
      throw invalid("INVALID_ARGUMENT","Unknown badge position");
    if (job.name === "timing badge" && (!Object.hasOwn(getNormalizedNodePins(node),pin) ||
        !["at","rt","slack","delay","slew"].includes(metric) || !["on","off"].includes(enabled)))
      throw invalid("INVALID_ARGUMENT","Unknown timing pin, metric or badge value");
    const choices = getTimingBadgeChoices(node,view.badges,key);
    updateBadges(view.side,key,job.name,pin,updateTimingBadgeChoices(choices,pin,metric,enabled === "on"));
    if (view.side) actions.renderCompareGraphs(); else actions.rerenderPreservingView(view.selected);
    return {id:node.id, choices:getTimingBadgeChoices(node,view.badges,key), position:view.positions[key] || node.timing?.badgePosition};
  }
  return job => completed(() => {
    const {name,args} = job;
    if (name.startsWith("cell-config ") && name !== "cell-config import") return actions.runCellConfigCommand(job);
    if (name === "timing metric" || name === "timing threshold") {
      const el = getElements();
      if (name === "timing metric") el.timingMetricSelect.value = args[0];
      else {
        if (!Number.isFinite(Number(args[0])) || !args[0].trim()) throw invalid("INVALID_ARGUMENT","Expected a finite timing threshold");
        el.timingSlackThresholdInput.value = args[0];
      }
      return settings().timing.commit();
    }
    if (["timing log-details","timing badge","timing badge-position","timing reset-badges"].includes(name)) return timingObject(job);
    if (!name.startsWith("compare ") || name === "compare design") return undefined;
    const syncSetting = compareSyncSettings.get(name);
    if (syncSetting || name === "compare split" || name === "compare cone-depth") {
      if (!settings().active()) throw invalid("DOMAIN_MISMATCH","Enter Compare first");
      const el = getElements();
      if (name === "compare split") {
        settings().layout(args[0]);
      } else if (name === "compare cone-depth") {
        const n = Number(args[0]);
        if (!Number.isInteger(n) || n < 1 || n > 99) throw invalid("INVALID_ARGUMENT","Depth must be between 1 and 99");
        el.coneDepthInput.value = String(n);
        actions.handleConeDepthChange({target:el.coneDepthInput});
      } else {
        settings()[syncSetting](args[0] === "on");
      }
      return actions.runCompareCommand({...job,name:"compare status"});
    }
    return actions.runCompareCommand(job);
  });
}
