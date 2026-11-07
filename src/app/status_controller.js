

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createStatusController({ state, elements, services }) {
  function setStatus(message) {
    elements.status.textContent = message;
  }

  function logProcess(level, phase, message, details = undefined, options = {}) {
    services.processLogController.append(level, phase, message, details, options);
  }

  return Object.freeze({ setStatus, logProcess });
}

export const statusPorts = Object.freeze({
  state: [

  ],
  elements: [
    "status"
  ],
  services: [
    "processLogController"
  ]
});
