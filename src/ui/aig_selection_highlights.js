export function updateAigSelectionHighlights(elements, previous, next, colors) {
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const role = next.get(id);
    const element = elements.get(id);
    if (!element) continue;
    if (role) element.setAttribute("data-neighbor-role", role);
    else element.removeAttribute("data-neighbor-role");
    for (const halo of element.querySelectorAll(".aig-neighbor-halo")) {
      halo.setAttribute("visibility", role ? "visible" : "hidden");
      if (role) halo.setAttribute("stroke", colors[role]);
    }
  }
}
