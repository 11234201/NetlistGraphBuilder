export const DEFAULT_LAYOUT_POLICY = Object.freeze({
  name: "schematic-readable-v1",
  spacing: Object.freeze({
    x: 260,
    y: 88,
    margin: 48,
    wireLanePitch: 18,
    cellPinPitch: 36,
    branchTopY: 80,
    branchLanePitch: 228,
    compactX: 196,
    fanoutX: 292,
    compactYGap: 8,
    fanoutYGap: 28
  }),
  features: Object.freeze({
    alignDrivenLinks: true,
    branchAwareLanes: true,
    localizeSingleFanoutInputs: true
  })
});

export const LAYOUT_SPACING_LIMITS = Object.freeze({
  x: Object.freeze([80, 1000]),
  y: Object.freeze([24, 400]),
  margin: Object.freeze([8, 200]),
  wireLanePitch: Object.freeze([8, 48]),
  cellPinPitch: Object.freeze([18, 72]),
  branchTopY: Object.freeze([0, 2000]),
  branchLanePitch: Object.freeze([40, 1000]),
  compactX: Object.freeze([80, 1000]),
  fanoutX: Object.freeze([80, 1600]),
  compactYGap: Object.freeze([0, 200]),
  fanoutYGap: Object.freeze([0, 400])
});

export function normalizeLayoutPolicy(policy = {}, legacyOptions = {}) {
  const spacing = {
    ...DEFAULT_LAYOUT_POLICY.spacing,
    ...(policy.spacing || {})
  };
  const features = {
    ...DEFAULT_LAYOUT_POLICY.features,
    ...(policy.features || {})
  };

  applyLegacySpacing(spacing, legacyOptions);
  applyLegacyFeatures(features, legacyOptions);
  normalizeSpacing(spacing);
  normalizeFeatures(features);

  return {
    name: policy.name || DEFAULT_LAYOUT_POLICY.name,
    spacing,
    features
  };
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
    ["wireLanePitch", "wireLanePitch"],
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
