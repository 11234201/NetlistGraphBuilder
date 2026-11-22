import { LIBERTY_LIMITS } from "../contracts/liberty.js";
import { completeQuickInputHeader, detectQuickInputKind, getQuickInputPriority, isIncompleteInputHeader, planAigLevelBatch, sortQuickInputBatch } from "../app/quickInput.js";
import { createBulkTextInput } from "./bulk_text_input.js";
import { errorMessage, readErrorField } from "../foundation/log_details.js";

export function createQuickInputController({ elements, windowTarget, loadText, setStatus, logProcess,
  importRequests, getInputPriority = getQuickInputPriority, getLevelTarget, readLevelFile, schedule = defaultSchedule }) {
  const reportFailure = (error, message, context = {}) => {
    if (readErrorField(error, "name") === "AbortError") return;
    try {
      logProcess?.("error", "import", message, { error, code: readErrorField(error, "code") || context.operation + ".failed", ...context },
        { onlyIfUnreported: context.kind === "timing" || context.kind === "level" || Boolean(context.levelFileName) });
    } catch { /* The failed input and its status remain available if logging fails. */ }
    setStatus(message);
  };
  let dragDepth = 0;
  let textKind = "netlist";
  let textOptions = { append: false, compareSide: null };
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
    if (kind === "aig" || kind === "level") return { request: importRequest, onFailureContext: (context) => Object.assign(details, context) };
    return { request: importRequest };
  }
  const checkFileSize = (file, kind) => {
    if (kind === "liberty" && file.size > LIBERTY_LIMITS.maxBytes) throw new Error("Liberty maxBytes exceeded (64 MiB)");
  };
  const readEntry = (entry) => entry.classificationText ?? (entry.kind === "level"
    ? readLevelFile(entry.file, importRequest.signal) : entry.file.text());
  let dialogSession = 0;
  let pendingSubmission = null;
  const formControl = (selector) => elements.textForm?.querySelector?.(selector);
  const submitButton = formControl("[data-text-submit]");
  const textStatus = formControl("[data-text-status]");
  const aigOptions = formControl("[data-aig-input-options]");
  const aigView = formControl("[data-aig-input-view]");
  let pasteView = aigView?.value;
  const showTextStatus = (message = "") => {
    if (!textStatus) return;
    textStatus.textContent = message;
    textStatus.hidden = !message;
  };
  const setSubmitting = (busy) => {
    elements.textForm?.setAttribute?.("aria-busy", String(busy));
    if (submitButton) {
      const indexOnly = textKind === "aig" && aigView?.value === "search-first";
      submitButton.disabled = busy;
      submitButton.textContent = textKind === "level" ? (busy ? "Applying…" : "Apply levels")
        : indexOnly ? (busy ? "Indexing…" : "Index") : (busy ? "Drawing…" : "Draw");
    }
    for (const control of [elements.textInput, aigView, formControl("[data-bulk-text-expand]"), formControl("[data-bulk-text-clear]")]) {
      if (control) control.disabled = busy;
    }
  };
  aigView?.addEventListener?.("change", () => {
    pasteView = aigView.value;
    setSubmitting(Boolean(pendingSubmission));
  });
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
  const loadFiles = async (files, batchOptions = {}) => {
    const requestId = beginRequest();
    const entries = [];
    let classificationFailed = false;
    for (const file of files) {
      if (!isCurrent(requestId)) return;
      let classificationText = null;
      let kind;
      const classify = (text) => detectQuickInputKind(text, { name: file.name, preferredKind: batchOptions.preferredKind });
      try {
        try {
          kind = classify("");
        } catch {
          // JSON root fields and headers following source comments may be
          // outside the sample or split across its last line.
          const sampleBytes = 65536;
          classificationText = file.slice ? await file.slice(0, sampleBytes).text() : await file.text();
          if (!isCurrent(requestId)) return;
          if (file.slice && file.size > sampleBytes && isIncompleteInputHeader(classificationText)) {
            classificationText = await completeQuickInputHeader(file, classificationText, sampleBytes, importRequest.signal);
            if (!isCurrent(requestId)) return;
          }
          const needsFullText = file.slice && (/\.json$/i.test(file.name) || classificationText.trimStart().startsWith("{"));
          if (!needsFullText) {
            try { kind = classify(classificationText); }
            catch (error) {
              // An individually selected design may put its module after a long preamble.
              if (batchOptions.operation !== "import-file" || !file.slice || !(file.size > sampleBytes)) throw error;
            }
          }
          if (!kind) {
            classificationText = await file.text();
            if (!isCurrent(requestId)) return;
            kind = classify(classificationText);
          }
          // Re-read real Files at import time instead of retaining every JSON
          // source in a batch. Test doubles without slice() reuse their only read.
          if (file.slice) classificationText = null;
        }
      } catch (error) {
        if (!isCurrent(requestId)) return;
        classificationFailed = true;
        reportFailure(error, `Load failed ${file.name}: ${errorMessage(error)}`, { fileName: file.name, operation: "classify-file" });
        continue;
      }
      entries.push({ file, classificationText, kind, name: file.name });
    }
    if (!isCurrent(requestId)) return;
    if (entries.filter((entry) => entry.kind === "liberty").length > 1) {
      reportFailure(undefined, "Load failed: choose one Liberty file per batch", { operation: "import-batch" });
      return;
    }
    // An unreadable generic file may have been the Level file's intended
    // main design. Never apply its companion to an older active graph.
    if (classificationFailed && entries.some(entry => entry.kind === "level")) return;
    let pairs;
    try { pairs = planAigLevelBatch(entries); }
    catch (error) {
      reportFailure(error, error.message, { kind: "level", fileName: error.fileName, operation: "pair-aig-level" });
      return;
    }
    sortQuickInputBatch(entries, getInputPriority);
    const hasNetlist = entries.some(entry => entry.kind === "netlist");
    let designLoaded = Boolean(batchOptions.append);
    const seenKind = { netlist: false, timing: false, aig: false };
    for (const entry of entries) {
      if (!isCurrent(requestId)) return;
      if (pairs.attachedLevels.has(entry)) continue;
      // A failed read of a generic text file may hide the batch's only
      // Verilog design. Its Timing report must not modify the previous design.
      const requiresDesign = hasNetlist || (classificationFailed && entry.kind === "timing");
      if (requiresDesign && !designLoaded && !["netlist", "aig", "liberty"].includes(entry.kind)) {
        setStatus(`Skipped ${entry.name}: no netlist in this batch loaded successfully`);
        continue;
      }
      const companion = pairs.levelForAig.get(entry);
      const details = { fileName: entry.name, kind: entry.kind, operation: batchOptions.operation || "import-batch",
        ...(companion ? { levelFileName: companion.name, designFileName: entry.name } : {}) };
      try {
        checkFileSize(entry.file, entry.kind);
        const text = await readEntry(entry);
        if (!isCurrent(requestId)) return;
        let levelFile;
        if (companion) {
          details.fileName = companion.name;
          details.operation = "aig.level.read";
          levelFile = { name: companion.name, text: await readEntry(companion) };
          if (!isCurrent(requestId)) return;
          details.fileName = entry.name;
          details.operation = "import-batch";
        }
        const appendable = ["netlist", "timing", "aig"].includes(entry.kind);
        const shouldAppend = appendable && (Boolean(batchOptions.append) || seenKind[entry.kind]);
        const extra = {
          ...(shouldAppend ? { append: true } : {}), ...(levelFile ? { levelFile } : {}),
          ...(entry.kind === "level" && batchOptions.levelTarget !== undefined ? { levelTarget: batchOptions.levelTarget } : {}),
          ...(batchOptions.compareSide ? { compareSide: batchOptions.compareSide } : {})
        };
        await loadText(text, { kind: entry.kind, label: entry.name, ...requestOptions(entry.kind, details), ...extra });
        if (appendable) seenKind[entry.kind] = true;
        if (entry.kind === "netlist") designLoaded = true;
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!isCurrent(requestId)) return;
        reportFailure(error, `Load failed ${details.fileName}: ${errorMessage(error)}`, details);
      }
    }
  };
  const loadInputFile = async (event, preferredKind, extraOptions = {}) => {
    const input = event.target;
    const files = [...(input.files || [])];
    if (files.length === 0) return;
    try {
      await loadFiles(files, { preferredKind, operation: files.length === 1 ? "import-file" : "import-batch", ...extraOptions });
    } finally {
      input.value = "";
    }
  };
  const closeDialog = () => {
    dialogSession += 1;
    textOptions = { append: false, compareSide: null };
    if (pendingSubmission) {
      const kind = pendingSubmission.kind;
      pendingSubmission.request.cancel();
      setStatus(kind === "aig" || kind === "level" ? "Paste cancelled" : "Drawing cancelled; parsed input remains loaded.");
    }
    showTextStatus();
    if (elements.textDialog?.open) elements.textDialog.close();
  };
  const openDialog = (kind, extraOptions = {}) => {
    beginRequest();
    dialogSession += 1;
    textKind = ["timing", "aig", "level"].includes(kind) ? kind : "netlist";
    textOptions = {
      append: Boolean(extraOptions.append),
      compareSide: extraOptions.compareSide || null,
      ...(textKind === "level" && getLevelTarget ? { levelTarget: getLevelTarget() } : {})
    };
    showTextStatus();
    if (aigOptions) aigOptions.hidden = textKind !== "aig";
    if (textKind === "aig" && aigView) aigView.value = elements.aigSearchFirstInput?.checked ? "search-first" : pasteView;
    setSubmitting(false);
    const sideSuffix = textOptions.compareSide === "left" ? " for A" : textOptions.compareSide === "right" ? " for B" : "";
    elements.textTitle.textContent = { timing: "Paste timing", aig: "Paste AIG", level: "Paste levels", netlist: "Paste Verilog" }[textKind] + sideSuffix;
    elements.textDescription.textContent = {
      timing: "粘贴标准时序文本（Tabular / CSV / JSON，默认 point at rt slack），解析成功后应用到当前设计。",
      level: "每行写一个输入名和初始层级，例如 a 3。完整报告可用表头 point at_level rt_level slack_level，应用到当前 AIG。",
      aig: "粘贴 ABC AIG DOT 或两输入组合 BLIF（.model / .names）。大图可选 Search-first，在布局前筛选逻辑。",
      netlist: "粘贴 structural Verilog，解析成功后立即画图。"
    }[textKind];
    if (!elements.textDialog.open) elements.textDialog.showModal();
    schedule(() => elements.textInput.focus());
  };

  elements.libertyInput?.addEventListener("change", (event) => loadInputFile(event, "liberty"));
  // These actions also invalidate reads that have not reached the library service.
  elements.cancelLibertyButton?.addEventListener("click", cancelPendingLoad);
  elements.clearLibertyButton?.addEventListener("click", cancelPendingLoad);
  function bindLevelAwarePicker(input, preferredKind) {
    let target;
    input?.addEventListener("click", () => { target = getLevelTarget?.(); });
    input?.addEventListener("change", (event) => {
      const levelTarget = target === undefined ? getLevelTarget?.() : target;
      target = undefined;
      return loadInputFile(event, preferredKind, { levelTarget });
    });
  }
  bindLevelAwarePicker(elements.netlistInput);
  elements.addDesignInput?.addEventListener("change", (event) => loadInputFile(event, "netlist", { append: true }));
  elements.timingInput?.addEventListener("change", (event) => loadInputFile(event, "timing"));
  elements.addTimingInput?.addEventListener("change", (event) => loadInputFile(event, "timing", { append: true }));
  bindLevelAwarePicker(elements.levelInput, "level");
  elements.goldenInput?.addEventListener("change", (event) => loadInputFile(event, "golden"));
  elements.pasteNetlistButton?.addEventListener("click", () => openDialog("netlist"));
  elements.pasteAigButton?.addEventListener("click", () => openDialog("aig"));
  elements.textForm?.ownerDocument?.getElementById?.("addAigText")?.addEventListener("click", () => openDialog("aig", { append: true }));
  elements.pasteTimingButton?.addEventListener("click", () => openDialog("timing"));
  elements.pasteLevelButton?.addEventListener("click", () => openDialog("level"));
  elements.compareLeftNetlistInput?.addEventListener("change", (event) => loadInputFile(event, "netlist", { append: true, compareSide: "left" }));
  elements.compareRightNetlistInput?.addEventListener("change", (event) => loadInputFile(event, "netlist", { append: true, compareSide: "right" }));
  elements.compareLeftTimingInput?.addEventListener("change", (event) => loadInputFile(event, "timing", { compareSide: "left" }));
  elements.compareRightTimingInput?.addEventListener("change", (event) => loadInputFile(event, "timing", { compareSide: "right" }));
  elements.compareLeftPasteNetlistButton?.addEventListener("click", () => openDialog("netlist", { append: true, compareSide: "left" }));
  elements.compareRightPasteNetlistButton?.addEventListener("click", () => openDialog("netlist", { append: true, compareSide: "right" }));
  elements.compareLeftPasteTimingButton?.addEventListener("click", () => openDialog("timing", { compareSide: "left" }));
  elements.compareRightPasteTimingButton?.addEventListener("click", () => openDialog("timing", { compareSide: "right" }));
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
  async function submitDraft(fromCommand = false) {
    if (pendingSubmission) {
      if (fromCommand) throw Object.assign(new Error("A submission is running"), {code:"BUSY"});
      return;
    }
    const source = textBuffer.getValue();
    if (!source.trim()) {
      const message = `Paste failed: ${textKind} text is empty`;
      showTextStatus(message);
      if (fromCommand) throw Object.assign(new Error(message), {code:"EMPTY_INPUT"});
      reportFailure(Object.assign(new Error(message), { code: "EMPTY_INPUT" }), message, { kind: textKind, operation: "paste-text" });
      elements.textInput.focus();
      return;
    }
    const requestId = beginRequest();
    const submittedDialogSession = dialogSession;
    const kind = textKind;
    const details = { kind, operation: "paste-text" };
    const deferLayout = kind === "aig" && aigView?.value === "search-first";
    const presentationPolicy = kind === "aig" && aigView ? { viewStyle: deferLayout ? "abc" : aigView.value } : undefined;
    const submitExtra = {
      ...(textOptions.append ? { append: true } : {}),
      ...(textOptions.compareSide ? { compareSide: textOptions.compareSide } : {}),
      ...(textOptions.levelTarget !== undefined ? { levelTarget: textOptions.levelTarget } : {})
    };
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
      if (finish() && submittedDialogSession === dialogSession && elements.textDialog?.open) showTextStatus("已取消，可修改后重新提交。");
    };
    submission.request.signal.addEventListener("abort", onAbort, { once: true });
    setSubmitting(true);
    showTextStatus(kind === "aig" ? (deferLayout ? "正在建立 AIG 索引…" : "正在解析并布局 AIG…可以点击 Cancel 取消。") : "正在处理文本…");
    try {
      await loadText(source, { kind, label: pastedLabel(kind), ...requestOptions(kind, details), ...(presentationPolicy ? { presentationPolicy, deferLayout } : {}), ...submitExtra });
      if (isCurrent(requestId) && submittedDialogSession === dialogSession) { finish(); closeDialog(); }
      else if (fromCommand) throw new DOMException("Submission superseded", "AbortError");
    } catch (error) {
      if (error?.name === "AbortError") onAbort();
      else if (isCurrent(requestId) && submittedDialogSession === dialogSession) {
        const message = `Paste failed: ${errorMessage(error)}`;
        const hint = error?.name === "TimeoutError" && kind === "aig"
          ? " 选择 Search-first 可先筛选再布局，也可选择 Logic View 重试。" : "";
        showTextStatus(message + hint);
        if (!fromCommand || kind === "level") reportFailure(error, message, details);
        finish();
        elements.textInput.focus();
      }
      if (fromCommand) {
        if (!isCurrent(requestId) || submittedDialogSession !== dialogSession)
          throw new DOMException("Submission superseded", "AbortError");
        throw error;
      }
    } finally {
      finish();
    }
  }
  elements.textForm?.addEventListener("submit", event => {
    event.preventDefault();
    return submitDraft();
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

  function draftCommand({name,args,opts}) {
    if (name === "text open") {
      if (!["netlist","aig","timing","level"].includes(args[0]) || opts.action && !["open","add"].includes(opts.action)
        || args[0] === "level" && (opts.action === "add" || opts.side))
        throw Object.assign(new Error("Unknown paste kind or action"), {code:"INVALID_ARGUMENT"});
      openDialog(args[0], {append:opts.action === "add", compareSide:{A:"left",B:"right"}[opts.side]});
    } else {
      if (!elements.textDialog?.open) throw Object.assign(new Error("Open the paste editor first"), {code:"EDITOR_CLOSED"});
      if (name === "text submit") return submitDraft(true).then(() => ({submitted:true, kind:textKind}));
      if (name === "text cancel") closeDialog();
      else if (pendingSubmission) throw Object.assign(new Error("A submission is running"), {code:"BUSY"});
      else if (name === "text set") textBuffer.setValue(args[0]);
      else if (name === "text clear") textBuffer.clear();
      else if (name === "text expand") textBuffer.expand();
      else if (name === "text view") {
        if (textKind !== "aig" || !["logic","standard","search-first"].includes(args[0]))
          throw Object.assign(new Error("Choose an AIG paste view"), {code:"INVALID_ARGUMENT"});
        aigView.value = args[0] === "logic" ? "abc" : args[0];
        aigView.dispatchEvent(new windowTarget.Event("change", {bubbles:true}));
      }
    }
    return {open:Boolean(elements.textDialog?.open), kind:textKind, length:textBuffer.getValue().length, preview:elements.textInput.readOnly};
  }
  return Object.freeze({ openDialog, closeDialog, clearDrag, loadFiles, draftCommand });
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
  return { liberty: "pasted Liberty", netlist: "pasted Verilog", aig: "pasted AIG", golden: "pasted Golden", timing: "pasted timing", level: "pasted Level" }[kind];
}
