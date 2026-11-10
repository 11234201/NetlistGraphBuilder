import { LIBERTY_LIMITS } from "../contracts/liberty.js";
export { LIBERTY_LIMITS } from "../contracts/liberty.js";

export function createLibertyLexer(text, sourceName = "library.lib") {
  if (typeof text !== "string") throw new TypeError("Liberty input must be text");
  if (text.length > LIBERTY_LIMITS.maxBytes) throw new Error(`${sourceName}: maxBytes exceeded`);
  let bytes = 0, lastPause = 0;
  let offset = 0, line = 1, column = 1;
  const position = () => ({ offset, line, column });
  const advance = () => {
    const code = text.charCodeAt(offset);
    bytes += code < 128 ? 1 : code < 2048 ? 2 : code >= 0xDC00 && code <= 0xDFFF &&
      text.charCodeAt(offset - 1) >= 0xD800 && text.charCodeAt(offset - 1) <= 0xDBFF ? 1 : 3;
    if (bytes > LIBERTY_LIMITS.maxBytes) throw new Error(`${sourceName}:${line}:${column}: maxBytes exceeded`);
    const character = text[offset++];
    if (character === "\n") { line += 1; column = 1; } else column += 1;
    return character;
  };
  const fail = (message, start = position()) => {
    throw new Error(`${sourceName}:${start.line}:${start.column}: ${message}`);
  };
  let commentStart = null, lineComment = false;
  function next() {
    for (;;) {
      if (offset - lastPause >= LIBERTY_LIMITS.sliceCharacters) {
        lastPause = offset;
        return { kind: "pause" };
      }
      if (commentStart) {
        if (offset === text.length) fail("Unterminated comment", commentStart);
        if (text.startsWith("*/", offset)) { advance(); advance(); commentStart = null; }
        else advance();
      } else if (lineComment) {
        if (offset === text.length || text[offset] === "\n") lineComment = false;
        else advance();
      } else if (/\s/.test(text[offset] || "") || text[offset] === "\uFEFF") advance();
      else if (text.startsWith("/*", offset)) {
        commentStart = position(); advance(); advance();
      } else if (text.startsWith("//", offset)) {
        lineComment = true; advance(); advance();
      } else if (text[offset] === "\\" && /[\r\n]/.test(text[offset + 1] || "")) {
        advance();
      } else break;
    }
    const start = position();
    if (offset === text.length) return { kind: "eof", value: "", start, end: position() };
    const first = advance();
    if ("(){}:;,=".includes(first)) return { kind: first, value: first, start, end: position() };
    let value = "";
    if (first === '"') {
      let closed = false;
      while (offset < text.length) {
        if (offset - start.offset > LIBERTY_LIMITS.maxToken) fail("maxToken exceeded", start);
        const character = advance();
        if (character === '"') { closed = true; break; }
        if (character === "\\") {
          if (offset === text.length) fail("Unterminated string", start);
          const escaped = advance();
          if (escaped === "\r") { if (text[offset] === "\n") advance(); }
          else if (escaped === "\n") continue;
          else if (escaped === '"' || escaped === "\\") value += escaped;
          else if (escaped !== undefined) value += `\\${escaped}`;
        } else value += character;
      }
      if (!closed) fail("Unterminated string", start);
      return { kind: "string", value, start, end: position() };
    }
    value = first;
    let brackets = first === "[" ? 1 : 0;
    while (offset < text.length) {
      const character = text[offset];
      if (/\s/.test(character) || "(){};,=".includes(character) || (character === ":" && brackets === 0) ||
          text.startsWith("/*", offset) || text.startsWith("//", offset)) break;
      if (offset - start.offset >= LIBERTY_LIMITS.maxToken) fail("maxToken exceeded", start);
      if (character === "[") brackets += 1;
      if (character === "]") brackets -= 1;
      value += advance();
    }
    return { kind: "word", value, start, end: position() };
  }
  return { next, fail, get offset() { return offset; }, get sizeBytes() { return bytes; } };
}
