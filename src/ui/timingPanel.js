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
  if (!node?.timing) {
    return "";
  }
  const pinsMap = getNormalizedNodePins(node);
  const pinList = Object.values(pinsMap).sort((left, right) =>
    String(left.pin).localeCompare(String(right.pin))
  );
  const hasDelay = pinList.some((pin) => Number.isFinite(pin.delay));
  const hasSlew = pinList.some((pin) => Number.isFinite(pin.slew));
  const hasEdge = pinList.some((pin) => Boolean(pin.edge));

  const headerCols = [
    "<th>Pin</th>",
    "<th>AT</th>",
    "<th>RT</th>",
    "<th>Slack</th>",
    hasDelay ? "<th>Delay</th>" : "",
    hasSlew ? "<th>Slew</th>" : "",
    hasEdge ? "<th>Edge</th>" : ""
  ].join("");

  const rows = pinList
    .map((pin) => {
      const cells = [
        `<td>${escapeHtml(pin.pin)}</td>`,
        renderTimingChoiceCell(pin, "at", choices),
        renderTimingChoiceCell(pin, "rt", choices),
        renderTimingChoiceCell(pin, "slack", choices),
        hasDelay ? renderTimingChoiceCell(pin, "delay", choices) : "",
        hasSlew ? renderTimingChoiceCell(pin, "slew", choices) : "",
        hasEdge ? `<td>${escapeHtml(pin.edge || "-")}</td>` : ""
      ].join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  const summaryRows = [
    ["Worst pin", node.timing.worstPin || "-"],
    ["Worst slack", formatNumber(node.timing.worstSlack)],
    ["Badges", node.timing.badges?.map((badge) => badge.label).join("; ") || "-"]
  ];
  if (node.timing.sourceKind === "net" && node.timing.sourceNet) {
    summaryRows.push(["Source net", node.timing.sourceNet]);
  }

  return `<div class="timing-list">
    <dl class="stats-list">${renderDefinitionRows(summaryRows)}</dl>
    <table class="timing-table">
      <thead><tr>${headerCols}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${renderBadgePosition(node.timing.badgePosition)}
    <button id="resetTimingBadgeButton" class="mini-button" type="button">Default badges</button>
  </div>`;
}

export function renderNetTimingPanel(netTiming) {
  if (!netTiming) {
    return "";
  }
  const rows = [
    ["Timing source", netTiming.driverPin || "Net root"],
    ["AT", formatNumber(netTiming.at)],
    ["RT", formatNumber(netTiming.rt)],
    ["Slack", formatNumber(netTiming.slack)]
  ];
  if (Number.isFinite(netTiming.delay)) rows.push(["Delay", formatNumber(netTiming.delay)]);
  if (Number.isFinite(netTiming.slew)) rows.push(["Slew", formatNumber(netTiming.slew)]);
  if (netTiming.edge) rows.push(["Edge", netTiming.edge]);

  return `<div class="timing-list">
    <dl class="stats-list">${renderDefinitionRows(rows)}</dl>
  </div>`;
}

export function getTimingBadgeChoices(node, badgeChoices, instance) {
  if (instance && Object.hasOwn(badgeChoices, instance)) {
    return normalizeBadgeChoices(badgeChoices[instance]);
  }
  return (node?.timing?.badges || []).map(({ pin, metric }) => ({ pin, metric }));
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

function getNormalizedNodePins(node) {
  if (node.timing?.pins && typeof node.timing.pins === "object") {
    return node.timing.pins;
  }
  const fallbackPin = node.ref?.displayName || node.ref?.name || node.label || "port";
  return {
    [fallbackPin]: {
      pin: fallbackPin,
      at: node.timing?.at ?? null,
      rt: node.timing?.rt ?? null,
      slack: node.timing?.slack ?? node.timing?.worstSlack ?? null,
      delay: node.timing?.delay ?? null,
      slew: node.timing?.slew ?? null,
      edge: node.timing?.edge ?? null
    }
  };
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
