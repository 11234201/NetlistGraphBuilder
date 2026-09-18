export const DEFAULT_LAYOUT_POLICY = Object.freeze({
  name: "schematic-readable-v1",
  spacing: Object.freeze({
    x: 260,
    y: 88,
    margin: 48,
    topPadding: 160,
    // Keep parallel net lanes readable at the default zoom. Routing and
    // congested channel-width calculations consume the same value.
    wireLanePitch: 24,
    cellSpacing: 8,
    cellPinPitch: 36,
    branchTopY: 80,
    branchLanePitch: 228,
    branchBandSize: 16,
    branchBandGap: 192,
    focusedTreeGroupGap: 512,
    recursiveTreeMaximumShift: 32,
    branchCenterGap: 2048,
    compactX: 196,
    fanoutX: 292,
    focusedFanoutX: 544,
    compactYGap: 8,
    fanoutYGap: 28
  }),
  features: Object.freeze({
    alignDrivenLinks: true,
    branchAwareLanes: true,
    // Centre layers around one visual axis and compact them toward median
    // neighbour-port positions while preserving the established layer order.
    // Generate legacy and balanced candidates, then keep the balanced result
    // only when its bounded placement score improves without dispersing the
    // shared column axis. The legacy path remains an automatic fallback.
    balancedLayerPlacement: true,
    // Preserve data-flow branch bands through repeated controlled sink banks
    // instead of allowing shared trunks to collapse every sink into one row
    // stack. Focused placement evaluates this as a bounded candidate.
    symmetricBranchPlacement: true,
    // Keep exclusive focused-fanin subtrees centred around their parents while
    // preserving the stable order and shared-node positions from block placement.
    recursiveFocusedTreePlacement: true,
    localizeSingleFanoutInputs: true,
    // Experimental until proper long-edge placement and chain routing land.
    // Enabling span minimization alone changes the geometry seen by the
    // legacy router and currently regresses valid mapped/focused fixtures.
    minimalSpanLayering: false,
    // Insert a dummy node for every column a long edge crosses so the edge
    // takes part in the ordering of the columns it passes through.
    // Long edges participate in every crossed layer's ordering. The physical
    // carrier pass below then turns their logical dummy chains into one shared
    // rendered net tree.
    longEdgeDummies: true,
    // Atomically route long physical nets through the carrier slots produced
    // by the proper layered graph.
    physicalCarrierRouting: true,
    // Let the physical capacity pass determine inter-layer width instead of
    // multiplying the initial gap by logical fanout.
    routingDrivenLayerSpacing: true,
    // Whole graphs opt into the proper-layering path only after their carrier
    // and gap routing acceptance gates pass. Focused graphs already use it.
    wholeProperLayering: true
  }),
  layering: Object.freeze({
    // Bounded deterministic relaxation that replaces the longest-path
    // ranking with a minimal-total-span ranking.
    relaxationSweeps: 8,
    // "constrained" places boundary nodes by constraint, next to their
    // targets. "source" keeps the legacy pin-to-first-level behaviour.
    boundaryAnchor: "constrained",
    // Primary ports belong on the leading or trailing edge of a schematic, so
    // they are excluded from the relaxation. Only nodes a Focused query
    // synthesized are free to move.
    anchorPrimaryPorts: true,
    // S2b initially reserves explicit through-layer tracks only for physical
    // nets whose branch count justifies a shared trunk.
    carrierMinimumFanout: 8,
    // Whole proper-layering needs slots for low-fanout long nets as well;
    // unlike Focused, it cannot rely on generous local whitespace.
    wholeCarrierMinimumFanout: 2,
    // Preserve dummy-chain slots for long single-load nets without turning
    // every adjacent-layer edge into a carrier.
    wholeCarrierMinimumSpan: 6,
    // Small Whole graphs keep the lightweight direct-routing path. Proper
    // layering becomes the product default only once graph size can benefit
    // from dummy-aware ordering and capacity channels.
    wholeProperLayeringMinimumNodes: 512,
    // Upper bound on the dummy nodes `longEdgeDummies` may create.
    maxDummyNodes: 40000
  })
});

export const LAYERING_LIMITS = Object.freeze({
  relaxationSweeps: Object.freeze([0, 64]),
  carrierMinimumFanout: Object.freeze([2, 1024]),
  wholeCarrierMinimumFanout: Object.freeze([1, 1024]),
  wholeCarrierMinimumSpan: Object.freeze([2, 64]),
  wholeProperLayeringMinimumNodes: Object.freeze([0, 100000]),
  maxDummyNodes: Object.freeze([0, 500000])
});

export const LAYOUT_SPACING_LIMITS = Object.freeze({
  x: Object.freeze([80, 1000]),
  y: Object.freeze([24, 400]),
  margin: Object.freeze([8, 200]),
  topPadding: Object.freeze([0, 800]),
  wireLanePitch: Object.freeze([4, 96]),
  cellSpacing: Object.freeze([4, 320]),
  cellPinPitch: Object.freeze([18, 72]),
  branchTopY: Object.freeze([0, 2000]),
  branchLanePitch: Object.freeze([40, 1000]),
  branchBandSize: Object.freeze([2, 128]),
  branchBandGap: Object.freeze([0, 1000]),
  focusedTreeGroupGap: Object.freeze([0, 1200]),
  recursiveTreeMaximumShift: Object.freeze([0, 1000]),
  branchCenterGap: Object.freeze([0, 6000]),
  compactX: Object.freeze([80, 1000]),
  fanoutX: Object.freeze([80, 1600]),
  focusedFanoutX: Object.freeze([80, 1600]),
  compactYGap: Object.freeze([0, 200]),
  fanoutYGap: Object.freeze([0, 400])
});

export const LAYOUT_SPACING_STEP = 4;

export function snapLayoutSpacingValue(value, limits, step = LAYOUT_SPACING_STEP, fallback = null) {
  const numeric = Number(value);
  const minimum = Number(limits?.[0]);
  const maximum = Number(limits?.[1]);
  const increment = Number(step);
  if (!Number.isFinite(numeric) || !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) || !Number.isFinite(increment) || increment <= 0) {
    return fallback;
  }
  return clamp(
    Math.round(clamp(numeric, minimum, maximum) / increment) * increment,
    minimum,
    maximum
  );
}

export function normalizeLayoutPolicy(policy = {}, legacyOptions = {}) {
  const spacing = {
    ...DEFAULT_LAYOUT_POLICY.spacing,
    ...(policy.spacing || {})
  };
  const features = {
    ...DEFAULT_LAYOUT_POLICY.features,
    ...(policy.features || {})
  };
  const layering = {
    ...DEFAULT_LAYOUT_POLICY.layering,
    ...(policy.layering || {})
  };

  applyLegacySpacing(spacing, legacyOptions);
  applyLegacyFeatures(features, legacyOptions);
  normalizeSpacing(spacing);
  normalizeFeatures(features);
  normalizeLayering(layering);

  return {
    name: policy.name || DEFAULT_LAYOUT_POLICY.name,
    spacing,
    features,
    layering
  };
}

function normalizeLayering(layering) {
  const sweeps = Number(layering.relaxationSweeps);
  layering.relaxationSweeps = Number.isFinite(sweeps)
    ? clamp(Math.floor(sweeps), LAYERING_LIMITS.relaxationSweeps[0], LAYERING_LIMITS.relaxationSweeps[1])
    : DEFAULT_LAYOUT_POLICY.layering.relaxationSweeps;
  layering.boundaryAnchor = layering.boundaryAnchor === "source" ? "source" : "constrained";
  layering.anchorPrimaryPorts = toBoolean(
    layering.anchorPrimaryPorts,
    DEFAULT_LAYOUT_POLICY.layering.anchorPrimaryPorts
  );
  const carrierMinimumFanout = Number(layering.carrierMinimumFanout);
  layering.carrierMinimumFanout = Number.isFinite(carrierMinimumFanout)
    ? clamp(Math.floor(carrierMinimumFanout), ...LAYERING_LIMITS.carrierMinimumFanout)
    : DEFAULT_LAYOUT_POLICY.layering.carrierMinimumFanout;
  const wholeCarrierMinimumFanout = Number(layering.wholeCarrierMinimumFanout);
  layering.wholeCarrierMinimumFanout = Number.isFinite(wholeCarrierMinimumFanout)
    ? clamp(Math.floor(wholeCarrierMinimumFanout), ...LAYERING_LIMITS.wholeCarrierMinimumFanout)
    : DEFAULT_LAYOUT_POLICY.layering.wholeCarrierMinimumFanout;
  const wholeCarrierMinimumSpan = Number(layering.wholeCarrierMinimumSpan);
  layering.wholeCarrierMinimumSpan = Number.isFinite(wholeCarrierMinimumSpan)
    ? clamp(Math.floor(wholeCarrierMinimumSpan), ...LAYERING_LIMITS.wholeCarrierMinimumSpan)
    : DEFAULT_LAYOUT_POLICY.layering.wholeCarrierMinimumSpan;
  const wholeProperLayeringMinimumNodes = Number(layering.wholeProperLayeringMinimumNodes);
  layering.wholeProperLayeringMinimumNodes = Number.isFinite(wholeProperLayeringMinimumNodes)
    ? clamp(
      Math.floor(wholeProperLayeringMinimumNodes),
      ...LAYERING_LIMITS.wholeProperLayeringMinimumNodes
    )
    : DEFAULT_LAYOUT_POLICY.layering.wholeProperLayeringMinimumNodes;
  const maximumDummies = Number(layering.maxDummyNodes);
  layering.maxDummyNodes = Number.isFinite(maximumDummies)
    ? clamp(Math.floor(maximumDummies), ...LAYERING_LIMITS.maxDummyNodes)
    : DEFAULT_LAYOUT_POLICY.layering.maxDummyNodes;
}

function normalizeSpacing(spacing) {
  for (const [key, [minimum, maximum]] of Object.entries(LAYOUT_SPACING_LIMITS)) {
    const fallback = DEFAULT_LAYOUT_POLICY.spacing[key];
    const value = Number(spacing[key]);
    spacing[key] = Number.isFinite(value)
      ? clamp(value, minimum, maximum)
      : fallback;
  }
}

function normalizeFeatures(features) {
  for (const key of Object.keys(DEFAULT_LAYOUT_POLICY.features)) {
    features[key] = toBoolean(features[key], DEFAULT_LAYOUT_POLICY.features[key]);
  }
}

function applyLegacySpacing(spacing, options) {
  const mappings = [
    ["xSpacing", "x"],
    ["ySpacing", "y"],
    ["margin", "margin"],
    ["topPadding", "topPadding"],
    ["wireLanePitch", "wireLanePitch"],
    ["cellSpacing", "cellSpacing"],
    ["cellPinPitch", "cellPinPitch"],
    ["branchTopY", "branchTopY"],
    ["branchLanePitch", "branchLanePitch"],
    ["compactX", "compactX"],
    ["fanoutX", "fanoutX"],
    ["compactYGap", "compactYGap"],
    ["fanoutYGap", "fanoutYGap"]
  ];

  for (const [optionKey, spacingKey] of mappings) {
    if (options[optionKey] !== undefined) {
      spacing[spacingKey] = options[optionKey];
    }
  }
}

function applyLegacyFeatures(features, options) {
  if (options.alignCellLinks !== undefined) {
    features.alignDrivenLinks = options.alignCellLinks;
  }
  if (options.branchAwareLanes !== undefined) {
    features.branchAwareLanes = options.branchAwareLanes;
  }
  if (options.localizeSingleFanoutInputs !== undefined) {
    features.localizeSingleFanoutInputs = options.localizeSingleFanoutInputs;
  }
}

function toBoolean(value, fallback) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
