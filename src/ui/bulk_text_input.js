// Keep bulk imports out of the browser's unbounded textarea selection/layout path.
// The preview is never used as source data: submission and full-selection copy
// read the retained original. Editing the complete text remains an explicit option.
export const BULK_TEXT_THRESHOLD = 256 * 1024;
export const BULK_TEXT_PREVIEW_LIMIT = 8192;

export function createBulkTextInput({ input, notice, expandButton, clearButton }) {
  let original = null;
  let expanded = false;

  function updateControls() {
    const preview = original !== null;
    input.readOnly = preview;
    if (expandButton) expandButton.hidden = !preview;
    if (notice) {
      notice.hidden = !preview;
      notice.textContent = preview
        ? `已保留完整文本（${original.length.toLocaleString()} 字符），此处仅显示开头预览。可直接粘贴替换；全选后复制及导入均使用完整原文。需要修改时请选择“展开编辑”。`
        : "";
    }
  }

  function setValue(value) {
    expanded = false;
    original = value.length > BULK_TEXT_THRESHOLD ? value : null;
    input.value = original === null ? value
      : value.slice(0, BULK_TEXT_PREVIEW_LIMIT).split("\n").slice(0, 80).join("\n");
    updateControls();
    input.setSelectionRange(0, 0);
    input.scrollTop = 0;
  }

  function clear() {
    setValue("");
    input.focus();
  }

  input.addEventListener("paste", (event) => {
    if (!event.clipboardData?.types.includes("text/plain")) return;
    const pasted = event.clipboardData.getData("text/plain");
    if (original === null && input.value.length + pasted.length <= BULK_TEXT_THRESHOLD) return;
    event.preventDefault();
    const value = original !== null ? pasted
      : input.value.slice(0, input.selectionStart) + pasted + input.value.slice(input.selectionEnd);
    setValue(value);
  });
  input.addEventListener("input", (event) => {
    if (!expanded && !event.isComposing && input.value.length > BULK_TEXT_THRESHOLD) setValue(input.value);
  });
  input.addEventListener("copy", (event) => {
    if (original === null || !event.clipboardData ||
        input.selectionStart !== 0 || input.selectionEnd !== input.value.length) return;
    event.clipboardData.setData("text/plain", original);
    event.preventDefault();
  });
  input.addEventListener("keydown", (event) => {
    if (original !== null && !event.isComposing && ["Backspace", "Delete"].includes(event.key) &&
        input.selectionStart === 0 && input.selectionEnd === input.value.length) {
      event.preventDefault();
      clear();
    }
  });
  expandButton?.addEventListener("click", () => {
    if (original === null) return;
    input.value = original;
    original = null;
    expanded = true;
    updateControls();
    input.focus();
  });
  clearButton?.addEventListener("click", clear);
  updateControls();

  return Object.freeze({ getValue: () => original ?? input.value, setValue, clear });
}
