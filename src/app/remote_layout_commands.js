import { listLayoutProviders } from "../layout/layoutProvider.js";
import { snapNodePosition } from "../layout/snap.js";
import { normalizePosition } from "../ui/canvas_node_drag_controller.js";
import { readSpacingInput } from "../ui/spacingControls.js";
import { invalid, number, reference, resolveNetlistObject } from "./remote_object_queries.js";

function enabled(word) {
  if (!["on","off"].includes(word)) throw invalid("INVALID_ARGUMENT","Expected on or off");
  return word === "on";
}

export function createLayoutCommands({read,actions,elements,renderCompletion,netRouting}) {
  const run = operation => renderCompletion.run(operation);
  return async function layout(job, view) {
    const {name,args,opts} = job;
    const side = view.side;
    const fresh = () => read(side);
    switch (name) {
      case "golden save":
        if (view.compare) throw invalid("DOMAIN_MISMATCH","Open Single view to save a Golden");
        return actions.saveLayoutGolden(true);
      case "display aliases":
      case "display hubs": {
        const alias = name === "display aliases", checked = enabled(args[0]);
        const control = alias ? elements.showAliasesInput : elements.fanoutHubsInput;
        if (checked !== (alias ? view.aliases : view.hubs)) {
          control.checked = checked;
          await run(() => alias ? actions.handleAliasVisibilityChange({target:control}) : actions.handleGraphSimplificationChange());
        }
        return {enabled:alias ? fresh().aliases : fresh().hubs};
      }
      case "display symbols":
        if (!["rectangle","conventional"].includes(args[0])) throw invalid("INVALID_ARGUMENT","Unknown symbol mode");
        await run(() => actions.commitGateSymbolMode(args[0]));
        return {symbols:fresh().symbols};
      case "layout providers": return listLayoutProviders();
      case "layout provider": {
        if (!listLayoutProviders().some(provider => provider.id === args[0]))
          throw invalid("INVALID_ARGUMENT","Unknown layout provider");
        if (args[0] !== view.provider) {
          elements.layoutProviderSelect.value = args[0];
          await run(() => actions.handleLayoutProviderChange({target:elements.layoutProviderSelect}));
        }
        if (fresh().provider !== args[0]) throw invalid("LAYOUT_FAILED","Requested provider could not complete the layout");
        return {provider:fresh().provider};
      }
      case "layout spacing": {
        const fields = [["wire","wireLanePitch"],["cell","cellSpacing"]].filter(([option]) => opts[option] !== undefined);
        const values = fields.map(([option,key]) => [key, readSpacingInput(number(opts[option],"spacing"),key,view.spacing[key])]);
        for (const [key,value] of values) if (value !== fresh().spacing[key]) await run(() => actions.commitLayoutSpacing(key,value));
        return {wire:fresh().spacing.wireLanePitch,cell:fresh().spacing.cellSpacing};
      }
      case "layout reset-overrides":
        await run(() => actions.resetLayoutOverrides());
        return {positions:fresh().positions.size,sizes:fresh().sizes.size};
      case "adjust mode":
        if (enabled(args[0]) !== view.adjust) actions.toggleCalibrationMode();
        return {enabled:fresh().adjust};
      case "net route": {
        const value = enabled(args[1]);
        const ref = reference(args[0]);
        const target = resolveNetlistObject(view,typeof ref === "string" ? {kind:"net",name:ref} : ref);
        if (target.kind !== "net") throw invalid("INVALID_ARGUMENT","Choose a net to route");
        await run(() => netRouting.setEnabled(target.name,value,side));
        return {net:target.name,enabled:netRouting.isEnabled(target.name,side)};
      }
    }
    if (!name.startsWith("adjust ")) return;
    const item = resolveNetlistObject(view,args[0]), node = item.node;
    if (!view.adjust) throw invalid("ADJUST_DISABLED","Enable Adjust mode first");
    if (!node || !view.graph?.nodes.some(n => n.id === node.id)) throw invalid("OBJECT_NOT_VISIBLE","Choose a visible node");
    const call = (operation,...values) => run(() => actions.runViewHistoryTransaction({label:name},() =>
      actions.editNodeOverride(side,node,operation,...values)));
    switch (name) {
      case "adjust move": {
        const target = {x:number(args[1],"x coordinate"),y:number(args[2],"y coordinate")};
        const {position} = snapNodePosition(view.graph,node.id,target);
        const commit = side ? change => actions.updateCompareOverrides(side,change) : actions.updateSingleOverrides;
        await run(() => actions.runViewHistoryTransaction({label:"Move node"}, () => {
          commit(overlay => overlay.nodePositions.set(node.id, normalizePosition(position)));
          return side ? actions.renderAdjustedCompareSide(side) : actions.commitNodeDrag(node.id);
        }));
        break;
      }
      case "adjust size":
        await call("onSizeChange",{width:number(args[1],"width"),height:number(args[2],"height")}); break;
      case "adjust reset-size": await call("onResetSize"); break;
      case "adjust property":
        if (!actions.isEditableNodeProperty(args[1])) throw invalid("INVALID_ARGUMENT","Unknown override property");
        await call("onPropertyChange",args[1],args[2]); break;
      case "adjust reset-properties": await call("onResetProperties"); break;
      case "adjust pin":
        if (!node.ref?.pins?.some(pin => pin.pin === args[1]) || !["input","output"].includes(args[2]))
          throw invalid("INVALID_ARGUMENT","Unknown pin or direction");
        await call("onPinDirectionChange",args[1],args[2]); break;
      case "adjust reset-pins": await call("onResetPinDirections"); break;
      default: return;
    }
    const current = fresh();
    return {id:node.id,position:current.positions.get(node.id) || null,size:current.sizes.get(node.id) || null,
      properties:current.overrides.nodeProperties[node.id] || {},pins:current.overrides.cellPinDirections[actions.getNodeInstance(node)] || {}};
  };
}
