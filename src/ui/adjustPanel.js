import { escapeAttr, escapeHtml } from "./html.js";

export function renderAdjustPanel(node, calibrationMode) {
  if (!calibrationMode) {
    return "";
  }
  return `${renderNodeSizeControls(node)}${renderNodePropertyControls(node)}${renderPinDirectionControls(node)}`;
}

export function bindAdjustPanel(container, node, calibrationMode, handlers) {
  if (!calibrationMode) {
    return;
  }

  const widthInput = container.querySelector("#nodeWidthInput");
  const heightInput = container.querySelector("#nodeHeightInput");
  widthInput?.addEventListener("input", () => {
    handlers.onSizeChange?.({
      width: widthInput.value,
      height: heightInput?.value ?? node.height
    });
  });
  heightInput?.addEventListener("input", () => {
    handlers.onSizeChange?.({
      width: widthInput?.value ?? node.width,
      height: heightInput.value
    });
  });
  container.querySelector("#resetNodeSizeButton")?.addEventListener("click", () => {
    handlers.onResetSize?.();
  });

  for (const input of container.querySelectorAll("[data-node-property]")) {
    input.addEventListener("change", () => {
      handlers.onPropertyChange?.(input.dataset.nodeProperty, input.value);
    });
  }
  container.querySelector("#resetNodePropertiesButton")?.addEventListener("click", () => {
    handlers.onResetProperties?.();
  });

  for (const select of container.querySelectorAll("[data-cell-pin]")) {
    select.addEventListener("change", () => {
      handlers.onPinDirectionChange?.(select.dataset.cellPin, select.value);
    });
  }
  container.querySelector("#resetPinDirectionsButton")?.addEventListener("click", () => {
    handlers.onResetPinDirections?.();
  });
}

function renderNodeSizeControls(node) {
  return `<div class="adjust-section size-controls" aria-label="Node size controls">
    <h3>Size</h3>
    <label>
      <span>Width</span>
      <input id="nodeWidthInput" type="number" min="24" max="420" step="1" value="${Math.round(node.width)}">
    </label>
    <label>
      <span>Height</span>
      <input id="nodeHeightInput" type="number" min="12" max="260" step="1" value="${Math.round(node.height)}">
    </label>
    <button id="resetNodeSizeButton" class="mini-button" type="button">Reset size</button>
  </div>`;
}

function renderNodePropertyControls(node) {
  const values = {
    label: node.label || "",
    title: node.title || "",
    subtitle: node.subtitle || "",
    gateKind: node.gateKind || "",
    inferenceSource: node.inferenceSource || ""
  };
  return `<div class="adjust-section property-controls" aria-label="Node property controls">
    <h3>Properties</h3>
    ${Object.entries(values)
      .map(
        ([key, value]) => `<label>
          <span>${escapeHtml(key)}</span>
          <input data-node-property="${escapeAttr(key)}" value="${escapeAttr(value)}">
        </label>`
      )
      .join("")}
    <button id="resetNodePropertiesButton" class="mini-button" type="button">Reset properties</button>
  </div>`;
}

function renderPinDirectionControls(node) {
  if (node.kind !== "cell") {
    return "";
  }
  const rows = (node.ref?.pins || [])
    .map((pin) => {
      const pinName = pin.pinDisplayName || pin.pin;
      const direction = node.pinDirections?.[pinName]?.direction || "input";
      return `<label class="pin-direction-row">
        <span>${escapeHtml(pinName)}</span>
        <select data-cell-pin="${escapeAttr(pin.pin)}" data-cell-pin-label="${escapeAttr(pinName)}">
          <option value="input"${direction === "input" ? " selected" : ""}>input</option>
          <option value="output"${direction === "output" ? " selected" : ""}>output</option>
        </select>
      </label>`;
    })
    .join("");
  return `<div class="adjust-section pin-direction-controls" aria-label="Pin direction controls">
    <h3>Pin directions</h3>
    ${rows}
    <button id="resetPinDirectionsButton" class="mini-button" type="button">Reset pin directions</button>
  </div>`;
}
