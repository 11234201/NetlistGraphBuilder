import { LIBERTY_LIMITS } from "../contracts/liberty.js";
import { detectQuickInputKind, getQuickInputPriority, isIncompleteBlifHeader } from "../app/quickInput.js";
import { createBulkTextInput } from "./bulk_text_input.js";
import { errorMessage, readErrorField } from "../foundation/log_details.js";

export function createQuickInputController({ elements, windowTarget, loadText, setStatus, logProcess,
  importRequests, getInputPriority = getQuickInputPriority, schedule = defaultSchedule }) {
  const reportFailure = (error, message, context = {}) => {
    if (readErrorField(error, "name") === "AbortError") return;
    try {
      logProcess?.("error", "import", message, { error, code: readErrorField(error, "code") || context.operation + ".failed", ...context });
    } catch { /* The failed input and its status remain available if logging fails. */ }
    setStatus(message);
  };
  let dragDepth = 0;
  let textKind = "netlist";
  let latestFileRequest = 0;
  let importRequest = null;
  const cancelPendingLoad = () => {
    importRequest?.cancel();
    importRequest = null;
    latestFileRequest += 1;
  };
  const beginRequest = () => {
    cancelPendingLoad();
    importRequest = importRequests.begin();
    return latestFileRequest;
  };
  const isCurrent = (requestId) => requestId === latestFileRequest && importRequest?.isCurrent();
  function requestOptions(kind, details) {
    if (kind === "liberty") return { signal: importRequest?.signal };
    if (kind === "aig") return { request: importRequest, onFailureContext: (context) => Object.assign(details, context) };
    return { request: importRequest };
  }
  const checkFileSize = (file, kind) => {
    if (kind === "liberty" && file.size > LIBERTY_LIMITS.maxBytes) throw new Error("Liberty maxBytes exceeded (64 MiB)");
  };
  let dialogSession = 0;
  let pendingSubmission = null;
  const formControl = (selector) => elements.textForm?.querySelector?.(selector);
  const submitButton = formControl("[data-text-submit]");
  const textStatus = formControl("[data-text-status]");
  const aigOptions = formControl("[data-aig-input-options]");
  const aigView = formControl("[data-aig-input-view]");
  const showTextStatus = (message = "") => {
    if (!textStatus) return;
    textStatus.textContent = message;
    textStatus.hidden = !message;
  };
  const setSubmitting = (busy) => {
    elements.textForm?.setAttribute?.("aria-busy", String(busy));
    if (submitButton) { submitButton.disabled = busy; submitButton.textContent = busy ? "Drawing…" : "Draw"; }
    for (const control of [elements.textInput, aigView, formControl("[data-bulk-text-expand]"), formControl("[data-bulk-text-clear]")]) {
      if (control) control.disabled = busy;
    }
  };
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
      if (!isCurrent(requestId)) return;
      let classificationText = null;
      let kind;
      try {
        try {
          kind = detectQuickInputKind("", { name: file.name });
        } catch {
          // JSON root fields and the first directive after a BLIF name table
          // can both fall outside the sample.
          const sampleBytes = 65536;
          classificationText = file.slice ? await file.slice(0, sampleBytes).text() : await file.text();
          if (!isCurrent(requestId)) return;
          if (file.slice && (/\.json$/i.test(file.name) || classificationText.trimStart().startsWith("{") ||
              file.size > sampleBytes && isIncompleteBlifHeader(classificationText))) {
            classificationText = await file.text();
            if (!isCurrent(requestId)) return;
          }
          kind = detectQuickInputKind(classificationText, { name: file.name });
          // Re-read real Files at import time instead of retaining every JSON
          // source in a batch. Test doubles without slice() reuse their only read.
          if (file.slice) classificationText = null;
        }
      } catch (error) {
        if (!isCurrent(requestId)) return;
        reportFailure(error, `Load failed ${file.name}: ${errorMessage(error)}`, { fileName: file.name, operation: "classify-file" });
        continue;
      }
      entries.push({ file, classificationText, kind, name: file.name, order });
    }
    if (!isCurrent(requestId)) return;
    if (entries.filter((entry) => entry.kind === "liberty").length > 1) {
      reportFailure(undefined, "Load failed: choose one Liberty file per batch", { operation: "import-batch" });
      return;
    }
    entries.sort((a, b) => getInputPriority(a.kind) - getInputPriority(b.kind) || a.order - b.order);
    let designLoaded = !entries.some((entry) => entry.kind === "netlist");
    for (const entry of entries) {
      if (!isCurrent(requestId)) return;
      if (entry.kind !== "netlist" && entry.kind !== "aig" && entry.kind !== "liberty" && !designLoaded) {
        setStatus(`Skipped ${entry.name}: no netlist in this batch loaded successfully`);
        continue;
      }
      const details = { fileName: entry.name, kind: entry.kind, operation: "import-batch" };
      try {
        checkFileSize(entry.file, entry.kind);
        const text = entry.file.slice ? await entry.file.text() : entry.classificationText ?? await entry.file.text();
        if (!isCurrent(requestId)) return;
        await loadText(text, { kind: entry.kind, label: entry.name, ...requestOptions(entry.kind, details) });
        if (entry.kind === "netlist") designLoaded = true;
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!isCurrent(requestId)) return;
        reportFailure(error, `Load failed ${entry.name}: ${errorMessage(error)}`, details);
      }
    }
  };
  const loadInputFile = async (event, preferredKind) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    const requestId = beginRequest();
    const details = { fileName: file.name, kind: preferredKind, operation: "import-file" };
    try {
      checkFileSize(file, preferredKind);
      const text = await file.text();
      if (!isCurrent(requestId)) return;
      const kind = detectQuickInputKind(text, { name: file.name, preferredKind });
      details.kind = kind;
      await loadText(text, { kind, label: file.name, ...requestOptions(kind, details) });
    } catch (error) {
      if (isCurrent(requestId)) reportFailure(error, `Load failed ${file.name}: ${errorMessage(error)}`, details);
    } finally {
      input.value = "";
    }
  };
  const closeDialog = () => {
    dialogSession += 1;
    if (pendingSubmission) {
      const kind = pendingSubmission.kind;
      pendingSubmission.request.cancel();
      setStatus(kind === "aig" ? "Paste cancelled" : "Drawing cancelled; parsed input remains loaded.");
    }
    showTextStatus();
    if (elements.textDialog?.open) elements.textDialog.close();
  };
  const openDialog = (kind) => {
    beginRequest();
    dialogSession += 1;
    textKind = ["timing", "aig"].includes(kind) ? kind : "netlist";
    showTextStatus();
    if (aigOptions) aigOptions.hidden = textKind !== "aig";
    const timing = textKind === "timing";
    elements.textTitle.textContent = timing ? "Paste timing" : textKind === "aig" ? "Paste AIG" : "Paste Verilog";
    elements.textDescription.textContent = timing
      ? "粘贴标准时序文本（Tabular / CSV / JSON，默认 point at rt slack），解析成功后应用到当前设计。"
      : textKind === "aig" ? "粘贴 ABC AIG DOT 或两输入组合 BLIF（.model / .names），解析成功后立即画图。"
      : "粘贴 structural Verilog，解析成功后立即画图。";
    if (!elements.textDialog.open) elements.textDialog.showModal();
    schedule(() => elements.textInput.focus());
  };

  elements.libertyInput?.addEventListener("change", (event) => loadInputFile(event, "liberty"));
  // These actions also invalidate reads that have not reached the library service.
  elements.cancelLibertyButton?.addEventListener("click", cancelPendingLoad);
  elements.clearLibertyButton?.addEventListener("click", cancelPendingLoad);
  elements.netlistInput?.addEventListener("change", (event) => loadInputFile(event));
  elements.timingInput?.addEventListener("change", (event) => loadInputFile(event, "timing"));
  elements.goldenInput?.addEventListener("change", (event) => loadInputFile(event, "golden"));
  elements.pasteNetlistButton?.addEventListener("click", () => openDialog("netlist"));
  elements.pasteAigButton?.addEventListener("click", () => openDialog("aig"));
  elements.pasteTimingButton?.addEventListener("click", () => openDialog("timing"));
  elements.closeTextButton?.addEventListener("click", closeDialog);
  elements.cancelTextButton?.addEventListener("click", closeDialog);
  elements.textDialog?.addEventListener?.("cancel", (event) => { event.preventDefault(); closeDialog(); });
  elements.textDialog?.addEventListener?.("close", () => { if (!elements.textDialog.open) closeDialog(); });
  elements.textInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      elements.textForm.requestSubmit();
    }
  });
  elements.textForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pendingSubmission) return;
    const source = textBuffer.getValue();
    if (!source.trim()) {
      const message = `Paste failed: ${textKind} text is empty`;
      showTextStatus(message);
      reportFailure(undefined, message, { kind: textKind, operation: "paste-text" });
      elements.textInput.focus();
      return;
    }
    const requestId = beginRequest();
    const submittedDialogSession = dialogSession;
    const kind = textKind;
    const details = { kind, operation: "paste-text" };
    const presentationPolicy = kind === "aig" && aigView ? { viewStyle: aigView.value } : undefined;
    const submission = { request: importRequest, kind };
    pendingSubmission = submission;
    const finish = () => {
      submission.request.signal.removeEventListener("abort", onAbort);
      if (pendingSubmission !== submission) return false;
      pendingSubmission = null;
      setSubmitting(false);
      return true;
    };
    const onAbort = () => {
      if (finish() && submittedDialogSession === dialogSession && elements.textDialog?.open) showTextStatus("已取消，可修改后重新绘图。");
    };
    submission.request.signal.addEventListener("abort", onAbort, { once: true });
    setSubmitting(true);
    showTextStatus(kind === "aig" ? "正在解析并布局 AIG…可以点击 Cancel 取消。" : "正在处理文本…");
    try {
      await loadText(source, { kind, label: pastedLabel(kind), ...requestOptions(kind, details), ...(presentationPolicy ? { presentationPolicy } : {}) });
      if (isCurrent(requestId) && submittedDialogSession === dialogSession) { finish(); closeDialog(); }
    } catch (error) {
      if (error?.name === "AbortError") onAbort();
      else if (isCurrent(requestId) && submittedDialogSession === dialogSession) {
        const message = `Paste failed: ${errorMessage(error)}`;
        const hint = error?.name === "TimeoutError" && presentationPolicy?.viewStyle === "standard"
          ? " 布局超时；请将 View 切换为 Logic View 后重试。" : "";
        showTextStatus(message + hint);
        reportFailure(error, message, details);
        finish();
        elements.textInput.focus();
      }
    } finally {
      finish();
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
    if (files.length > 0) loadFiles(files).catch((error) => reportFailure(error, `Drop failed: ${errorMessage(error)}`, { operation: "drop-files" }));
  });
  windowTarget?.addEventListener("dragend", clearDrag);
  windowTarget?.addEventListener("paste", async (event) => {
    if (elements.textDialog?.open || isEditableInputTarget(event.target)) return;
    const files = [...(event.clipboardData?.files || [])];
    if (files.length > 0) {
      event.preventDefault();
      loadFiles(files).catch((error) => reportFailure(error, `Paste failed: ${errorMessage(error)}`, { operation: "paste-files" }));
      return;
    }
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text.trim()) return;
    let kind;
    try { kind = detectQuickInputKind(text); } catch { return; }
    event.preventDefault();
    const requestId = beginRequest();
    const label = pastedLabel(kind);
    const details = { kind, operation: "paste-text" };
    try { await loadText(text, { kind, label, ...requestOptions(kind, details) }); }
    catch (error) {
      if (isCurrent(requestId)) reportFailure(error, `Paste failed: ${errorMessage(error)}`, details);
    }
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

function pastedLabel(kind) {
  return { liberty: "pasted Liberty", netlist: "pasted Verilog", aig: "pasted AIG", golden: "pasted Golden", timing: "pasted timing" }[kind];
}
