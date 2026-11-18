// Canonical node polarity is the reference for paths and connections. An
// inverted source alias names the opposite signal and is shown explicitly.
export function aigObjectLabel(node) {
  const mapped = node.primaryNameMapping || node.nameMappings?.find((row) => !row.conflict);
  if (!mapped || (mapped.name === node.label && !mapped.inverted)) return node.label;
  return `${node.label} · ${mapped.name}${mapped.inverted ? " (inverted)" : ""}`;
}
