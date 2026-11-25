export function getNodeInstance(node) {
  return node?.ref?.instance || node?.ref?.name || node?.label || "";
}

export function getLeafDisplayNameOrPort(node) {
  const raw = node?.ref?.displayName || node?.ref?.name || node?.label || "";
  return String(raw).trim();
}

export function unescapeSlashes(value) {
  return String(value || "").replace(/\\+\//g, "/");
}

export function normalizePinName(value) {
  return String(value || "")
    .trim()
    .replace(/^\\/, "")
    .replace(/\\+([[\]/$.])/g, "$1");
}

export function normalizeHierarchicalName(value) {
  return String(value || "")
    .trim()
    .replace(/\\(\S+)\s+\//g, "$1/")
    .replace(/^\\/, "")
    .replace(/\/\\/g, "/")
    .replace(/\\+([[\]$.])/g, "$1")
    .replace(/\s+\[/g, "[")
    .trim();
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findLastUnescapedSlash(text) {
  for (let index = text.length - 1; index > 0; index -= 1) {
    if (text[index] !== "/") continue;
    let backslashes = 0;
    for (let j = index - 1; j >= 0 && text[j] === "\\"; j -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return index;
  }
  return -1;
}
