import { detectQuickInputKind, getQuickInputPriority } from "../app/quickInput.js";

export function createQuickInputController({ elements, windowTarget, loadText, setStatus, schedule = defaultSchedule }) {
  let dragDepth = 0;
  let textKind = "netlist";

  const clearDrag = () => {
    dragDepth = 0;
    elements.body?.classList.remove("is-dragging-files");
    elements.dropOverlay?.setAttribute("aria-hidden", "true");
  };
  const showDrag = () => {
    elements.body?.classList.add("is-dragging-files");
    elements.dropOverlay?.setAttribute("aria-hidden", "false");
  };
  const loadFiles = async (files) => {
    const entries = await Promise.all([...files].map(async (file, order) => {
      const text = await file.text();
      return { text, kind: detectQuickInputKind(text, { name: file.name }), name: file.name, order };
    }));
    entries.sort((a, b) => getQuickInputPriority(a.kind) - getQuickInputPriority(b.kind) || a.order - b.order);
    for (const entry of entries) {
      await loadText(entry.text, { kind: entry.kind, label: entry.name });
    }
  };
  const loadInputFile = async (event, preferredKind) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const kind = detectQuickInputKind(text, { name: file.name, preferredKind });
      await loadText(text, { kind, label: file.name });
    } catch (error) {
      setStatus(`Load failed ${file.name}: ${error.message}`);
    } finally {
      input.value = "";
    }
  };
  const closeDialog = () => {
    if (elements.textDialog?.open) elements.textDialog.close();
  };
  const openDialog = (kind) => {
    textKind = kind === "timing" ? "timing" : "netlist";
    const timing = textKind === "timing";
    elements.textTitle.textContent = timing ? "Paste timing" : "Paste Verilog";
    elements.textDescription.textContent = timing
      ? "粘贴 Global/Local 表格或 LocResyn timing，解析成功后应用到当前设计。"
      : "粘贴 structural Verilog，解析成功后立即画图。";
    if (!elements.textDialog.open) elements.textDialog.showModal();
    schedule(() => elements.textInput.focus());
  };

  elements.netlistInput?.addEventListener("change", (event) => loadInputFile(event, "netlist"));
  elements.timingInput?.addEventListener("change", (event) => loadInputFile(event, "timing"));
  elements.goldenInput?.addEventListener("change", (event) => loadInputFile(event, "golden"));
  elements.pasteNetlistButton?.addEventListener("click", () => openDialog("netlist"));
  elements.pasteTimingButton?.addEventListener("click", () => openDialog("timing"));
  elements.closeTextButton?.addEventListener("click", closeDialog);
  elements.cancelTextButton?.addEventListener("click", closeDialog);
  elements.textInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      elements.textForm.requestSubmit();
    }
  });
  elements.textForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const source = elements.textInput.value.trim();
    if (!source) {
      setStatus(`Paste failed: ${textKind} text is empty`);
      elements.textInput.focus();
      return;
    }
    try {
      await loadText(source, { kind: textKind, label: textKind === "timing" ? "pasted timing" : "pasted Verilog" });
      closeDialog();
    } catch (error) {
      setStatus(`Paste failed: ${error.message}`);
      elements.textInput.focus();
    }
  });

  windowTarget?.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    showDrag();
  });
  windowTarget?.addEventListener("dragover", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    showDrag();
  });
  windowTarget?.addEventListener("dragleave", () => {
    if (dragDepth === 0) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) clearDrag();
  });
  windowTarget?.addEventListener("drop", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])];
    clearDrag();
    if (files.length > 0) loadFiles(files).catch((error) => setStatus(`Drop failed: ${error.message}`));
  });
  windowTarget?.addEventListener("dragend", clearDrag);
  windowTarget?.addEventListener("paste", async (event) => {
    if (elements.textDialog?.open || isEditableInputTarget(event.target)) return;
    const files = [...(event.clipboardData?.files || [])];
    if (files.length > 0) {
      event.preventDefault();
      loadFiles(files).catch((error) => setStatus(`Paste failed: ${error.message}`));
      return;
    }
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text.trim()) return;
    let kind;
    try { kind = detectQuickInputKind(text); } catch { return; }
    event.preventDefault();
    const label = kind === "netlist" ? "pasted Verilog" : kind === "golden" ? "pasted Golden" : "pasted timing";
    try { await loadText(text, { kind, label }); } catch (error) { setStatus(`Paste failed: ${error.message}`); }
  });

  return Object.freeze({ openDialog, closeDialog, clearDrag, loadFiles });
}

export function isEditableInputTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

function carriesFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files") || (event.dataTransfer?.files?.length || 0) > 0;
}

function defaultSchedule(task) {
  globalThis.requestAnimationFrame?.(task) ?? setTimeout(task, 0);
}
