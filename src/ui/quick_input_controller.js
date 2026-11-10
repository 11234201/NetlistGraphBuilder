import { LIBERTY_LIMITS } from "../contracts/liberty.js";
import { detectQuickInputKind, getQuickInputPriority } from "../app/quickInput.js";
import { createBulkTextInput } from "./bulk_text_input.js";

export function createQuickInputController({ elements, windowTarget, loadText, setStatus, schedule = defaultSchedule }) {
  let dragDepth = 0;
  let textKind = "netlist";
  let latestFileRequest = 0;
  let importController = null;
  const beginRequest = () => {
    importController?.abort();
    importController = new AbortController();
    return ++latestFileRequest;
  };
  const libraryOptions = (kind) => kind === "liberty" ? { signal: importController?.signal } : {};
  const checkFileSize = (file, kind) => {
    if (kind === "liberty" && file.size > LIBERTY_LIMITS.maxBytes) throw new Error("Liberty maxBytes exceeded (64 MiB)");
  };
  let dialogSession = 0;
  const textBuffer = createBulkTextInput({
    input: elements.textInput,
    notice: elements.textForm?.querySelector?.("[data-bulk-text-notice]"),
    expandButton: elements.textForm?.querySelector?.("[data-bulk-text-expand]"),
    clearButton: elements.textForm?.querySelector?.("[data-bulk-text-clear]")
  });

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
    const requestId = beginRequest();
    const entries = [];
    for (const [order, file] of [...files].entries()) {
      if (requestId !== latestFileRequest) return;
      let classificationText = null;
      let kind;
      try {
        try {
          kind = detectQuickInputKind("", { name: file.name });
        } catch {
          // Ambiguous extensions only need a prefix for classification. Real File
          // objects expose slice(); small test doubles fall back to one full read.
          classificationText = file.slice ? await file.slice(0, 65536).text() : await file.text();
          kind = detectQuickInputKind(classificationText, { name: file.name });
        }
      } catch (error) {
        if (requestId !== latestFileRequest) return;
        setStatus(`Load failed ${file.name}: ${error.message}`);
        continue;
      }
      entries.push({ file, classificationText, kind, name: file.name, order });
    }
    entries.sort((a, b) => getQuickInputPriority(a.kind) - getQuickInputPriority(b.kind) || a.order - b.order);
    let designLoaded = !entries.some((entry) => entry.kind === "netlist");
    for (const entry of entries) {
      if (requestId !== latestFileRequest) return;
      if (entry.kind !== "netlist" && entry.kind !== "liberty" && !designLoaded) {
        setStatus(`Skipped ${entry.name}: no netlist in this batch loaded successfully`);
        continue;
      }
      try {
        checkFileSize(entry.file, entry.kind);
        const text = entry.file.slice ? await entry.file.text() : entry.classificationText ?? await entry.file.text();
        if (requestId !== latestFileRequest) return;
        await loadText(text, { kind: entry.kind, label: entry.name, ...libraryOptions(entry.kind) });
        if (entry.kind === "netlist") designLoaded = true;
      } catch (error) {
        if (error.name === "AbortError") return;
        if (requestId !== latestFileRequest) return;
        setStatus(`Load failed ${entry.name}: ${error.message}`);
      }
    }
  };
  const loadInputFile = async (event, preferredKind) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    const requestId = beginRequest();
    try {
      checkFileSize(file, preferredKind);
      const text = await file.text();
      if (requestId !== latestFileRequest) return;
      const kind = detectQuickInputKind(text, { name: file.name, preferredKind });
      await loadText(text, { kind, label: file.name, ...libraryOptions(kind) });
    } catch (error) {
      if (requestId === latestFileRequest && error.name !== "AbortError") setStatus(`Load failed ${file.name}: ${error.message}`);
    } finally {
      input.value = "";
    }
  };
  const closeDialog = () => {
    dialogSession += 1;
    if (elements.textDialog?.open) elements.textDialog.close();
  };
  const openDialog = (kind) => {
    beginRequest();
    dialogSession += 1;
    textKind = kind === "timing" ? "timing" : "netlist";
    const timing = textKind === "timing";
    elements.textTitle.textContent = timing ? "Paste timing" : "Paste Verilog";
    elements.textDescription.textContent = timing
      ? "粘贴标准时序文本（Tabular / CSV / JSON，默认 point at rt slack），解析成功后应用到当前设计。"
      : "粘贴 structural Verilog，解析成功后立即画图。";
    if (!elements.textDialog.open) elements.textDialog.showModal();
    schedule(() => elements.textInput.focus());
  };

  elements.libertyInput?.addEventListener("change", (event) => loadInputFile(event, "liberty"));
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
    const source = textBuffer.getValue().trim();
    if (!source) {
      setStatus(`Paste failed: ${textKind} text is empty`);
      elements.textInput.focus();
      return;
    }
    const requestId = beginRequest();
    const submittedDialogSession = dialogSession;
    try {
      await loadText(source, { kind: textKind, label: textKind === "timing" ? "pasted timing" : "pasted Verilog" });
      if (requestId === latestFileRequest && submittedDialogSession === dialogSession) closeDialog();
    } catch (error) {
      if (requestId === latestFileRequest && submittedDialogSession === dialogSession) {
        setStatus(`Paste failed: ${error.message}`);
        elements.textInput.focus();
      }
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
    const requestId = beginRequest();
    const label = kind === "liberty" ? "pasted Liberty" : kind === "netlist" ? "pasted Verilog" : kind === "golden" ? "pasted Golden" : "pasted timing";
    try { await loadText(text, { kind, label, ...libraryOptions(kind) }); }
    catch (error) { if (requestId === latestFileRequest && error.name !== "AbortError") setStatus(`Paste failed: ${error.message}`); }
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
