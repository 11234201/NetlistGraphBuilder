import {
  normalizeBadgeChoices,
  TIMING_BADGE_POSITIONS,
  TIMING_METRICS
} from "../timing/timingAnnotation.js";
import { escapeAttr, escapeHtml, formatNumber, renderDefinitionRows } from "./html.js";

const POSITION_LABELS = {
  "bottom-right": "Bottom right",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "top-left": "Top left"
};

export function renderTimingPanel(node, choices) {
  if (!node.timing) {
    return "";
  }
  const rows = Object.values(node.timing.pins)
    .sort((left, right) => left.pin.localeCompare(right.pin))
    .map(
      (pin) =>
        `<tr><td>${escapeHtml(pin.pin)}</td>${renderTimingChoiceCell(pin, "at", choices)}${renderTimingChoiceCell(pin, "rt", choices)}${renderTimingChoiceCell(pin, "slack", choices)}</tr>`
    )
    .join("");

  return `<div class="timing-list">
    <dl class="stats-list">${renderDefinitionRows([
      ["Worst pin", node.timing.worstPin || "-"],
      ["Worst slack", formatNumber(node.timing.worstSlack)],
      ["Badges", node.timing.badges?.map((badge) => badge.label).join("; ") || "-"]
    ])}</dl>
    <table class="timing-table">
      <thead><tr><th>Pin</th><th>AT</th><th>RT</th><th>Slack</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${renderBadgePosition(node.timing.badgePosition)}
    <button id="resetTimingBadgeButton" class="mini-button" type="button">Default badges</button>
  </div>`;
}

export function getTimingBadgeChoices(node, badgeChoices, instance) {
  if (Object.hasOwn(badgeChoices, instance)) {
    return normalizeBadgeChoices(badgeChoices[instance]);
  }
  return (node.timing?.badges || []).map(({ pin, metric }) => ({ pin, metric }));
}

export function updateTimingBadgeChoices(choices, pin, metric, checked) {
  if (!TIMING_METRICS.includes(metric)) {
    return choices;
  }
  const next = normalizeBadgeChoices(choices).filter(
    (choice) => choice.pin !== pin || choice.metric !== metric
  );
  if (checked) {
    next.push({ pin, metric });
  }
  return next;
}

export function bindTimingPanel(container, handlers) {
  container.querySelector("#timingBadgePositionSelect")?.addEventListener("change", (event) => {
    handlers.onPositionChange?.(event.target.value);
  });

  for (const input of container.querySelectorAll("[data-timing-pin]")) {
    input.addEventListener("change", () => {
      handlers.onBadgeToggle?.(
        input.dataset.timingPin,
        input.dataset.timingMetric,
        input.checked
      );
    });
  }

  container.querySelector("#resetTimingBadgeButton")?.addEventListener("click", () => {
    handlers.onReset?.();
  });
}

export function isTimingBadgePosition(value) {
  return TIMING_BADGE_POSITIONS.includes(value);
}

function renderTimingChoiceCell(pin, metric, choices) {
  const checked = choices.some((choice) => choice.pin === pin.pin && choice.metric === metric)
    ? " checked"
    : "";
  return `<td><label class="timing-choice">
    <input type="checkbox" data-timing-pin="${escapeAttr(pin.pin)}" data-timing-metric="${metric}"${checked}>
    <span>${formatNumber(pin[metric])}</span>
  </label></td>`;
}

function renderBadgePosition(position = "bottom-right") {
  return `<label class="timing-position-control">
    <span>Badge position</span>
    <select id="timingBadgePositionSelect">
      ${TIMING_BADGE_POSITIONS
        .map((value) => `<option value="${value}"${position === value ? " selected" : ""}>${POSITION_LABELS[value]}</option>`)
        .join("")}
    </select>
  </label>`;
}
