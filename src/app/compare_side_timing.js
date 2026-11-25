import { mergeImportedTiming } from "../domains/netlist/timing_import.js";

export function createCompareSideTiming({ readCompare, elements, readTiming, renderCompareGraphs, renderStats, setStatus }) {
  function updateCompareSideStatus(side, module, status) {
    const compare = readCompare();
    const header = elements.compareMount.querySelector(`[data-compare-side="${side}"] > header`);
    if (!header) return;
    const timingLabel = compare.sideTiming?.[side]
      ? (compare.sideTimingLabels?.[side] || "timing override")
      : null;
    const base = `${side === "left" ? "A" : "B"} · ${module?.displayName || module?.name || side}`;
    const label = timingLabel ? `${base} · ${timingLabel}` : base;
    const rawDetail = module?.name && module.name !== module.displayName ? `${base}\n${module.name}` : base;
    header.title = timingLabel ? `${rawDetail}\nTiming (${side === "left" ? "A" : "B"}): ${timingLabel}` : rawDetail;
    header.textContent = status === "loading"
      ? `${label} · Loading…`
      : status === "failed" ? `${label} · Failed`
        : status === "cancelled" ? `${label} · Cancelled` : label;
  }

  function updateCompareSideTimingControls() {
    const compare = readCompare();
    for (const [side, statusEl, clearBtn] of [
      ["left", elements.compareLeftTimingStatus, elements.compareLeftClearTimingButton],
      ["right", elements.compareRightTimingStatus, elements.compareRightClearTimingButton]
    ]) {
      const sideTiming = compare.sideTiming?.[side];
      const label = compare.sideTimingLabels?.[side];
      if (statusEl) {
        const shared = readTiming();
        statusEl.textContent = sideTiming
          ? `${label || "override"} (${sideTiming.instanceCount})`
          : shared ? `shared (${shared.instanceCount})` : "none";
      }
      if (clearBtn) clearBtn.hidden = !sideTiming;
    }
  }

  function setCompareSideTiming(side, timing, label, { append = false } = {}) {
    const compare = readCompare();
    if (side !== "left" && side !== "right") return null;
    const next = assignCompareSideTiming(compare, side, timing, label, append);
    compare.timingBadgeChoices[side] = {};
    compare.timingBadgePositions[side] = {};
    updateCompareSideTimingControls();
    return next;
  }

  function clearCompareSideTiming(side, { render = true, onCommitted = null } = {}) {
    const compare = readCompare();
    if (side !== "left" && side !== "right") return;
    if (!compare.sideTiming?.[side]) return;
    compare.sideTiming[side] = null;
    compare.sideTimingLabels[side] = null;
    compare.timingBadgeChoices[side] = {};
    compare.timingBadgePositions[side] = {};
    updateCompareSideTimingControls();
    if (render && compare.active) {
      renderCompareGraphs({
        onCommitted: () => {
          renderStats();
          setStatus(`Cleared ${side === "left" ? "A" : "B"} timing override`);
          onCommitted?.();
        }
      });
    }
  }

  return { updateCompareSideStatus, updateCompareSideTimingControls, setCompareSideTiming, clearCompareSideTiming };
}

export function assignCompareSideTiming(compare, side, timing, label, append) {
  const prev = compare.sideTiming?.[side] || null;
  const prevLabel = compare.sideTimingLabels?.[side];
  const next = append && prev ? mergeImportedTiming(prev, timing) : timing;
  if (compare.sideTiming) compare.sideTiming[side] = next;
  if (compare.sideTimingLabels) {
    compare.sideTimingLabels[side] = append && prev && prevLabel ? `${prevLabel} + ${label}` : label;
  }
  return next;
}
