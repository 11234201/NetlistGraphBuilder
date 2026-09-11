const SVG_SCENE_KIND = "svg-scene.v1";

export function createSvgScene(value) {
  if (!value || value.kind !== SVG_SCENE_KIND) throw new Error("Expected an SVG scene");
  if (!value.bounds || !Number.isFinite(value.bounds.width) || !Number.isFinite(value.bounds.height) ||
      value.bounds.width < 0 || value.bounds.height < 0) {
    throw new Error("SVG scene bounds are required");
  }
  if (typeof value.readEdges !== "function" || typeof value.readNodes !== "function") {
    throw new Error("SVG scene requires lazy edge and node readers");
  }
  return Object.freeze({
    ...value,
    bounds: Object.freeze({ width: value.bounds.width, height: value.bounds.height }),
    ariaLabel: String(value.ariaLabel || "Diagram"),
    edgeCount: normalizeCount(value.edgeCount, "edgeCount"),
    nodeCount: normalizeCount(value.nodeCount, "nodeCount")
  });
}

export function createProgressiveSvgSceneRenderPlan(scene) {
  const checked = createSvgScene(scene);
  const width = Math.max(640, Math.ceil(checked.bounds.width));
  const height = Math.max(420, Math.ceil(checked.bounds.height));
  return Object.freeze({
    edgeCount: checked.edgeCount,
    nodeCount: checked.nodeCount,
    renderEdges: (start, end) => checked.readEdges(start, end).map(serializeSvgPrimitive),
    renderNodes: (start, end) => checked.readNodes(start, end).map(serializeSvgPrimitive),
    openSvg: `<svg class="schematic-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttribute(checked.ariaLabel)}">
  <g id="schematicContent">
    <g class="edges">`,
    betweenGroups: `</g><g class="nodes">`,
    closeSvg: `</g></g></svg>`
  });
}

export function renderSvgScene(scene) {
  const plan = createProgressiveSvgSceneRenderPlan(scene);
  return `${plan.openSvg}${plan.renderEdges(0, plan.edgeCount).join("")}${plan.betweenGroups}${plan.renderNodes(0, plan.nodeCount).join("")}${plan.closeSvg}`;
}

export const SVG_SCENE_CONTRACT = SVG_SCENE_KIND;

export function svgElement(tag, attributes = {}, children = []) {
  if (!/^[a-z][a-z0-9-]*$/i.test(tag)) throw new Error(`Invalid SVG element: ${tag}`);
  return Object.freeze({
    type: "element",
    tag,
    attributes: Object.freeze({ ...attributes }),
    children: Object.freeze([...(children || [])])
  });
}

export function svgText(value) {
  return Object.freeze({ type: "text", value: String(value ?? "") });
}

export function serializeSvgPrimitive(primitive) {
  if (primitive?.type === "text") return escapeText(primitive.value);
  if (primitive?.type !== "element") throw new Error("Unknown SVG scene primitive");
  const attributes = Object.entries(primitive.attributes || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([name, value]) => {
      if (!/^[a-z_:][a-z0-9_.:-]*$/i.test(name) || /^on/i.test(name)) {
        throw new Error(`Invalid SVG attribute: ${name}`);
      }
      return ` ${name}="${escapeAttribute(value === true ? "" : value)}"`;
    })
    .join("");
  const children = (primitive.children || []).map(serializeSvgPrimitive).join("");
  return `<${primitive.tag}${attributes}>${children}</${primitive.tag}>`;
}

function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}

function normalizeCount(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`SVG scene ${label} must be a non-negative integer`);
  return value;
}
