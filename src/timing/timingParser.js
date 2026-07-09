const NUMBER_PATTERN = "[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?";
const PIN_PATTERN = new RegExp(
  `pin\\s+([^,\\s]+)\\s*,\\s*at\\s+(${NUMBER_PATTERN})\\s*,\\s*rt\\s+(${NUMBER_PATTERN})\\s*,\\s*slack\\s+(${NUMBER_PATTERN})`,
  "gi"
);
const INSTANCE_PATTERN = /\[D\]\[LocResyn\]\s+inst\s*<([^>]+)>/gi;

export function parseTimingLog(text) {
  const source = String(text || "");
  const instances = {};
  const matches = [...source.matchAll(INSTANCE_PATTERN)];

  for (const [index, match] of matches.entries()) {
    const fullPath = match[1].trim();
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const block = source.slice(start, end);
    const instance = getLeafInstance(fullPath);
    const pins = parsePins(block);
    const summary = summarizePins(pins);

    instances[instance] = {
      instance,
      fullPath,
      pins,
      worstPin: summary.worstPin,
      worstSlack: summary.worstSlack
    };
  }

  return {
    kind: "locresyn-timing",
    instanceCount: Object.keys(instances).length,
    instances
  };
}

export function annotateGraphTiming(graph, timing) {
  if (!timing?.instances) {
    return graph;
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.kind !== "cell") {
        return node;
      }
      const instance = node.ref?.instance || node.label;
      const nodeTiming = timing.instances[instance];
      return nodeTiming ? { ...node, timing: nodeTiming } : node;
    })
  };
}

function parsePins(block) {
  const pins = {};
  PIN_PATTERN.lastIndex = 0;
  for (const match of block.matchAll(PIN_PATTERN)) {
    const pin = match[1];
    pins[pin] = {
      pin,
      at: Number(match[2]),
      rt: Number(match[3]),
      slack: Number(match[4])
    };
  }
  return pins;
}

function summarizePins(pins) {
  let worstPin = null;
  let worstSlack = null;
  for (const pin of Object.values(pins)) {
    if (worstSlack === null || pin.slack < worstSlack) {
      worstPin = pin.pin;
      worstSlack = pin.slack;
    }
  }
  return { worstPin, worstSlack };
}

function getLeafInstance(fullPath) {
  const parts = String(fullPath).split("/");
  return parts[parts.length - 1] || fullPath;
}
