// Domain-generated primitives are serialized by the injected presentation port.
// Selection updates touch only the old/new result members. Dimming uses one root
// attribute; label installation is batched independently of the main graph.
export function createAigStructureCanvas({ mount, serialize, readBaseEdgeStyle, schedule = requestAnimationFrame }) {
  let elements = new Map(), positions = new Map(), previous = null, labels = null, epoch = 0;
  function label(element, primitive) {
    element.querySelector(":scope > .aig-block-label")?.remove();
    if (primitive) element.insertAdjacentHTML("beforeend", serialize(primitive));
  }
  function update(next) {
    const svg = mount.querySelector("svg");
    if (!svg) return;
    svg.setAttribute("data-aig-analysis-active", String(next.active));
    svg.setAttribute("data-aig-analysis-dim", String(next.dim));
    svg.setAttribute("data-aig-block-labels", String(next.labelsVisible));
    for (const id of new Set([...(previous?.nodeRoles.keys() || []), ...next.nodeRoles.keys()])) {
      const element = elements.get(id), position = positions.get(id);
      if (!element || !position) continue;
      element.querySelector(":scope > .aig-structure-selection")?.remove();
      const role = next.nodeRoles.get(id);
      if (role) {
        element.setAttribute("data-aig-analysis-role", role);
        element.insertAdjacentHTML("beforeend", `<g class="aig-structure-selection" pointer-events="none">${next.nodeOverlay(position).map(serialize).join("")}</g>`);
      } else element.removeAttribute("data-aig-analysis-role");
    }
    for (const id of new Set([...(previous?.edgeRoles.keys() || []), ...next.edgeRoles.keys()])) {
      const element = elements.get(id);
      if (!element) continue;
      const role = next.edgeRoles.get(id), style = { ...readBaseEdgeStyle(id), ...next.edgeStyle(id) };
      if (role) element.setAttribute("data-aig-analysis-role", role); else element.removeAttribute("data-aig-analysis-role");
      for (const shape of element.querySelectorAll(".aig-edge-path")) for (const [name, value] of Object.entries(style)) {
        if (value == null) shape.removeAttribute(name); else shape.setAttribute(name, value);
      }
      for (const arrow of element.querySelectorAll(".aig-edge-arrow")) { arrow.setAttribute("fill", style.stroke); arrow.setAttribute("stroke", style.stroke); }
    }
    if (labels !== next.labels) {
      const ticket = ++epoch, ids = [...new Set([...(labels?.keys() || []), ...next.labels.keys()])];
      labels = next.labels;
      let offset = 0;
      const batch = () => {
        if (ticket !== epoch) return;
        const end = Math.min(offset + 100, ids.length);
        for (; offset < end; offset++) { const id = ids[offset], element = elements.get(id); if (element) label(element, labels.get(id)); }
        if (offset < ids.length) schedule(batch);
      };
      batch();
    }
    previous = next;
  }
  return Object.freeze({ update,
    bind(nextElements, nextPositions) { epoch++; elements = nextElements; positions = nextPositions; previous = null; labels = null; },
    dispose() { epoch++; elements = new Map(); positions = new Map(); previous = null; labels = null; } });
}
