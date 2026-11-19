const KIND_ALIASES = new Map([
  ["module", "module"],
  ["port", "port"],
  ["bus port", "port"],
  ["net", "net"],
  ["bus net", "net"],
  ["instance", "instance"],
  ["inst", "instance"],
  ["cell", "instance"]
]);

export function parseAttributeComment(commentText, line = null) {
  const trimmed = String(commentText || "").trim();
  if (!trimmed) return null;

  const prefixMatch = trimmed.match(/^(module|bus\s+port|port|bus\s+net|net|instance|inst|cell)\s*:\s*(.+)$/i);
  if (!prefixMatch) return null;

  const normalizedKind = prefixMatch[1].replace(/\s+/g, " ").toLowerCase();
  const targetKind = KIND_ALIASES.get(normalizedKind);
  if (!targetKind) return null;

  const rest = prefixMatch[2];
  const typeSeparator = findTypeSeparator(rest);
  if (!typeSeparator) return null;

  const rawTarget = rest.slice(0, typeSeparator.index).trim();
  const target = parseAttributeTarget(rawTarget);
  if (!target) return null;

  const afterType = rest.slice(typeSeparator.end).trim();
  const segments = splitCommaOutsideQuotes(afterType);
  if (segments.length < 2) return null;

  const category = unquoteAttributeValue(segments[0].trim());
  if (!category) return null;

  const entries = [];
  for (const segment of segments.slice(1)) {
    const eqIndex = findEqualsOutsideQuotes(segment);
    if (eqIndex <= 0) return null;
    const key = segment.slice(0, eqIndex).trim();
    const rawValue = segment.slice(eqIndex + 1).trim();
    if (!key || !rawValue) return null;
    entries.push({
      category,
      key,
      value: unquoteAttributeValue(rawValue),
      rawValue,
      line
    });
  }

  return entries.length ? {
    targetKind,
    isBus: normalizedKind.startsWith("bus "),
    target,
    entries
  } : null;
}

export function parseAttributeTarget(rawTarget) {
  const trimmed = String(rawTarget || "").trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("\\")) {
    const escapedWithRange = trimmed.match(/^\\(\S+)\s+(\[(-?\d+):(-?\d+)\])$/);
    if (escapedWithRange) {
      const baseName = escapedWithRange[1];
      const rangeText = escapedWithRange[2].replace(/\s+/g, "");
      return {
        targetName: `${baseName}${rangeText}`,
        displayName: `\\${baseName} ${rangeText}`,
        baseName,
        bitBaseName: null,
        rangeFallbackBase: baseName,
        escaped: true,
        isRangeTarget: true,
        isBitTarget: false
      };
    }
    const escapedWithBit = trimmed.match(/^\\(\S+)\s+(\[(-?\d+)\])$/);
    if (escapedWithBit) {
      const baseName = escapedWithBit[1];
      const bitText = escapedWithBit[2];
      return {
        targetName: `${baseName}${bitText}`,
        displayName: `\\${baseName} ${bitText}`,
        baseName: null,
        bitBaseName: baseName,
        rangeFallbackBase: null,
        escaped: true,
        isRangeTarget: false,
        isBitTarget: true
      };
    }
    const body = trimmed.slice(1).trim();
    if (!body) return null;
    const rangeFallback = body.match(/^(.*)\[(-?\d+):(-?\d+)\]$/);
    const bitFallback = !rangeFallback ? body.match(/^(.*)\[(-?\d+)\]$/) : null;
    return {
      targetName: body,
      displayName: `\\${body}`,
      baseName: null,
      bitBaseName: bitFallback ? bitFallback[1].trim() : null,
      rangeFallbackBase: rangeFallback ? rangeFallback[1].trim() : null,
      escaped: true,
      isRangeTarget: false,
      isBitTarget: Boolean(bitFallback)
    };
  }

  const normalized = trimmed.replace(/\s+\[/g, "[");
  const rangeMatch = normalized.match(/^(.*)\[(-?\d+):(-?\d+)\]$/);
  if (rangeMatch) {
    return {
      targetName: normalized,
      displayName: normalized,
      baseName: rangeMatch[1].trim(),
      bitBaseName: null,
      rangeFallbackBase: null,
      escaped: false,
      isRangeTarget: true,
      isBitTarget: false
    };
  }

  const bitMatch = normalized.match(/^(.*)\[(-?\d+)\]$/);
  if (bitMatch) {
    return {
      targetName: normalized,
      displayName: normalized,
      baseName: null,
      bitBaseName: bitMatch[1].trim(),
      rangeFallbackBase: null,
      escaped: false,
      isRangeTarget: false,
      isBitTarget: true
    };
  }

  return {
    targetName: normalized,
    displayName: normalized,
    baseName: null,
    bitBaseName: null,
    rangeFallbackBase: null,
    escaped: false,
    isRangeTarget: false,
    isBitTarget: false
  };
}

function isUnescapedQuote(text, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 0;
}

function findTypeSeparator(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && isUnescapedQuote(text, index)) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ",") {
      const tail = text.slice(index + 1);
      const typeMatch = tail.match(/^\s*type\s*=\s*/i);
      if (typeMatch) {
        return { index, end: index + 1 + typeMatch[0].length };
      }
    }
  }
  return null;
}

function splitCommaOutsideQuotes(text) {
  const parts = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && isUnescapedQuote(text, index)) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ",") {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function findEqualsOutsideQuotes(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && isUnescapedQuote(text, index)) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "=") {
      return index;
    }
  }
  return -1;
}

function unquoteAttributeValue(raw) {
  const text = String(raw || "").trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\"/g, '"');
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/\\'/g, "'");
  }
  return text;
}
