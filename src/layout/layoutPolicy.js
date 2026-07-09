export const DEFAULT_LAYOUT_POLICY = Object.freeze({
  name: "schematic-readable-v1",
  spacing: Object.freeze({
    y: 88,
    margin: 48,
    wireLanePitch: 18,
    cellPinPitch: 36,
    branchTopY: 80,
    branchLanePitch: 228
  }),
  features: Object.freeze({
    alignDrivenLinks: true,
    branchAwareLanes: true,
    localizeSingleFanoutInputs: true
  })
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

  return {
    name: policy.name || DEFAULT_LAYOUT_POLICY.name,
    spacing,
    features
  };
}

function applyLegacySpacing(spacing, options) {
  const mappings = [
    ["ySpacing", "y"],
    ["margin", "margin"],
    ["wireLanePitch", "wireLanePitch"],
    ["cellPinPitch", "cellPinPitch"],
    ["branchTopY", "branchTopY"],
    ["branchLanePitch", "branchLanePitch"]
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
