import { getLeafDisplayName } from "../../layout/nodeGeometry.js";
import { svgElement, svgText } from "../../render/svg_scene_renderer.js";

export function createNetlistNodePrimitive(node, presentationPolicy = {}) {
  if (node.kind === "input" || node.kind === "focus-input" || node.kind === "output" || node.kind === "focus-output") {
    return createPortPrimitive(node, node.kind);
  }
  if (node.kind === "implicit" || node.kind === "constant") return createSimplePrimitive(node, node.kind);
  if (node.kind === "hub") return createHubPrimitive(node);
  return createCellPrimitive(node, presentationPolicy);
}

function createHubPrimitive(node) {
  return svgElement("g", nodeAttributes(node, "node hub"), [
    svgElement("title", {}, [svgText(`Fanout: ${node.label}`)]),
    svgElement("circle", {
      class: "node-shape",
      cx: round(node.x + node.width / 2),
      cy: round(node.y + node.height / 2),
      r: 5
    })
  ]);
}

function createPortPrimitive(node, portKind) {
  const x = round(node.x);
  const y = round(node.y);
  const width = round(node.width);
  const height = round(node.height);
  const isInput = portKind === "input" || portKind === "focus-input";
  const points = isInput
    ? `${x},${y} ${x + width - 14},${y} ${x + width},${y + height / 2} ${x + width - 14},${y + height} ${x},${y + height}`
    : `${x + 14},${y} ${x + width},${y} ${x + width},${y + height} ${x + 14},${y + height} ${x},${y + height / 2}`;
  const timingMetrics = node.timing?.metrics || (node.timing ? {
    at: node.timing.at, rt: node.timing.rt, slack: node.timing.slack
  } : null);
  const children = [];
  if (node.boundaryDirection) {
    children.push(title(`${node.title || "Focused boundary"}: ${node.label}; hidden endpoint(s): ${node.hiddenEndpointCount || 0}`));
  }
  if (timingMetrics) {
    const values = Object.entries(timingMetrics)
      .filter(([, value]) => Number.isFinite(value))
      .map(([name, value]) => `${name} ${formatTimingValue(value)}`).join(", ");
    children.push(title(`${node.label}: ${values}`));
  }
  children.push(
    svgElement("polygon", { class: "node-shape", points }),
    svgElement("text", {
      class: "node-label", x: x + width / 2, y: y + height / 2 + 4, "text-anchor": "middle"
    }, [svgText(getLeafDisplayName(node.label))])
  );
  const timingClass = node.timing ? (node.timing.slack < 0 ? " timing-critical" : " timing-annotated") : "";
  return svgElement("g", nodeAttributes(node, `node ${portKind}${timingClass}`), children);
}

function createSimplePrimitive(node, className) {
  const x = round(node.x);
  const y = round(node.y);
  const width = round(node.width);
  const height = round(node.height);
  return svgElement("g", nodeAttributes(node, `node ${className}`), [
    svgElement("rect", { class: "node-shape", x, y, width, height }),
    svgElement("text", {
      class: "node-label", x: x + width / 2, y: y + height / 2 + 4, "text-anchor": "middle"
    }, [svgText(getLeafDisplayName(node.label))])
  ]);
}

function createCellPrimitive(node, presentationPolicy) {
  const x = round(node.x);
  const y = round(node.y);
  const width = round(node.width);
  const height = round(node.height);
  const gateKind = node.gateKind || "blackbox";
  const timingClass = getTimingClass(node);
  const focusedClass = node.isActiveFocusedRoot
    ? " focused-root focused-root-active"
    : node.isFocusedRoot ? " focused-root" : "";
  const useConventionalSymbol = presentationPolicy.gateSymbolMode === "conventional" &&
    isConventionalGateKind(gateKind);
  const symbolClass = useConventionalSymbol ? " gate-conventional" : "";
  const attributes = nodeAttributes(node, `node ${gateKind} ${node.kind}${timingClass}${focusedClass}${symbolClass}`);
  if (node.navigationTarget) {
    attributes["data-navigation-kind"] = node.navigationTarget.kind;
    attributes["data-navigation-id"] = node.navigationTarget.id;
  }
  const children = [];
  if (node.subtitle) {
    const navigationHint = node.navigationTarget?.kind === "unit"
      ? `; double-click to open ${node.navigationTarget.id}` : "";
    children.push(title(`${node.subtitle}: ${node.label}${node.metadataText ? `; ${node.metadataText}` : ""}${navigationHint}`));
  }
  children.push(createGateShape(node, gateKind, useConventionalSymbol, x, y, width, height));
  children.push(...createPortPrimitives(node, x, y, width));
  const timingBadge = createTimingBadge(node, x, y, width, height);
  if (timingBadge) children.push(timingBadge);
  children.push(
    svgElement("text", {
      class: "gate-kind", x: x + width / 2, y: y + 22, "text-anchor": "middle"
    }, [svgText(node.title || gateKind.toUpperCase())]),
    svgElement("text", {
      class: "node-label", x: x + width / 2, y: y + 42, "text-anchor": "middle"
    }, [svgText(getLeafDisplayName(node.label))])
  );
  if (node.kind === "cell" && node.metadataText && getTimingBadgeLines(node).length === 0) {
    children.push(svgElement("text", {
      class: "node-meta", x: x + width / 2, y: y + height - 6, "text-anchor": "middle"
    }, [svgText(truncateText(node.metadataText, 34))]));
  }
  return svgElement("g", attributes, children);
}

function isConventionalGateKind(gateKind) {
  return new Set(["and", "nand", "or", "nor", "xor", "xnor", "buf", "inv"]).has(gateKind);
}

function createGateShape(node, gateKind, conventional, x, y, width, height) {
  if (!conventional) return svgElement("rect", { class: "node-shape", x, y, width, height });
  const inset = Math.min(12, Math.max(5, width * 0.08));
  const left = x + inset;
  const right = x + width - inset;
  const top = y + inset;
  const bottom = y + height - inset;
  const mid = y + height / 2;
  if (gateKind === "buf" || gateKind === "inv") {
    return svgElement("polygon", {
      class: "node-shape",
      points: `${left},${top} ${left},${bottom} ${right},${mid}`
    });
  }
  if (gateKind === "and" || gateKind === "nand") {
    const shoulder = left + (right - left) * 0.45;
    const d = `M ${left} ${top} L ${shoulder} ${top} A ${(right - shoulder)} ${(bottom - top) / 2} 0 0 1 ${shoulder} ${bottom} L ${left} ${bottom} Z`;
    return svgElement("path", { class: "node-shape", d });
  }
  const shoulder = left + (right - left) * 0.42;
  const d = `M ${left} ${top} Q ${left + (right - left) * 0.18} ${mid} ${left} ${bottom} Q ${shoulder} ${bottom} ${right} ${mid} Q ${shoulder} ${top} ${left} ${top} Z`;
  const shape = svgElement("path", { class: "node-shape", d });
  if (gateKind !== "xor" && gateKind !== "xnor") return shape;
  const extraD = `M ${left - 7} ${top} Q ${left + (right - left) * 0.11} ${mid} ${left - 7} ${bottom}`;
  return svgElement("g", {}, [shape, svgElement("path", { class: "gate-extra-shape", d: extraD })]);
}

function createPortPrimitives(node, x, y, width) {
  return (node.ports || []).flatMap((port) => {
    const px = round(x + port.x);
    const py = round(y + port.y);
    const isOutput = port.direction === "output";
    const vertical = port.side === "top" || port.side === "bottom";
    const labelX = vertical ? px : isOutput ? px - 6 : px + 6;
    const labelY = port.side === "top" ? py + 13 : port.side === "bottom" ? py - 7 : py + 3;
    const anchor = vertical ? "middle" : isOutput ? "end" : "start";
    const timing = node.timing?.pins?.[port.pin];
    const timingClass = timing ? (timing.slack < 0 ? " pin-critical" : " pin-timing") : "";
    const markerChildren = timing ? [title(`${port.pin}: at ${formatTimingValue(timing.at)}, rt ${formatTimingValue(timing.rt)}, slack ${formatTimingValue(timing.slack)}`)] : [];
    const marker = isOutput && node.outputBubble === true
      ? svgElement("circle", { class: `pin-bubble${timingClass}`, cx: round(x + width + 5), cy: py, r: 5 }, markerChildren)
      : svgElement("circle", { class: `pin-dot${timingClass}`, cx: px, cy: py, r: 2.4 }, markerChildren);
    return [marker, svgElement("text", {
      class: "pin-label", x: labelX, y: labelY, "text-anchor": anchor
    }, [svgText(port.pin)])];
  });
}

function createTimingBadge(node, x, y, width, height) {
  const lines = getTimingBadgeLines(node);
  if (lines.length === 0) return null;
  const position = node.timing?.badgePosition || "bottom-right";
  const isLeft = position.endsWith("left");
  const isBottom = position.startsWith("bottom");
  const badgeX = round(isLeft ? x + 6 : x + width - 6);
  const badgeY = round(isBottom ? y + height - 8 - (lines.length - 1) * 11 : y + 14);
  return svgElement("text", {
    class: `timing-badge timing-badge-${position}`,
    x: badgeX,
    y: badgeY,
    "text-anchor": isLeft ? "start" : "end"
  }, lines.map((line, index) => svgElement("tspan", { x: badgeX, dy: index ? 11 : 0 }, [svgText(line)])));
}

function getTimingBadgeLines(node) {
  if (Array.isArray(node.timing?.badges)) {
    const byPin = new Map();
    for (const badge of node.timing.badges) {
      if (!byPin.has(badge.pin)) byPin.set(badge.pin, []);
      byPin.get(badge.pin).push(`${badge.metric} ${formatTimingValue(badge.value)}`);
    }
    return [...byPin].map(([pin, values]) => `${pin} ${values.join(" ")}`);
  }
  if (node.timing?.badge) return [node.timing.badge.label];
  if (Number.isFinite(node.timing?.worstSlack)) return [formatTimingValue(node.timing.worstSlack)];
  return [];
}

function getTimingClass(node) {
  if (!node.timing) return "";
  return node.timing.worstSlack < 0 ? " timing-critical" : " timing-annotated";
}

function nodeAttributes(node, className) {
  return { class: className, "data-node-id": node.id, "data-kind": node.kind, "data-label": node.label };
}

function title(value) { return svgElement("title", {}, [svgText(value)]); }
function round(value) { return Math.round(value * 10) / 10; }
function formatTimingValue(value) { return Number.isFinite(value) ? Number(value).toFixed(3) : "-"; }
function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}
