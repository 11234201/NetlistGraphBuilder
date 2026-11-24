// Interactive receipts. The IPC, Tcl and redirected cmd output keep their wire format.
function safe(value) {
  return String(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
      char => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
}

function label(key) {
  const words = safe(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatPromptStartup({pairUrl, stateFile}) {
  return "Open workbench: " + safe(pairUrl) + "\nState file: " + safe(stateFile) +
    "\nType help to list commands. Use ↑ and ↓ for history.";
}

function* rows(value, indent = "", prefix = "") {
  const entries = value && typeof value === "object" ? Object.entries(value) : null;
  if (!entries) {
    const text = value === null ? "—" : safe(value);
    yield indent + prefix + text.replaceAll("\n", "\n" + indent + "  ");
    return;
  }
  if (!entries.length) {
    yield indent + prefix + "(none)";
    return;
  }
  if (prefix) yield indent + prefix.trimEnd();
  const next = prefix ? indent + "  " : indent;
  for (const [key, item] of entries) {
    yield* rows(item, next, Array.isArray(value) ? "- " : label(key) + ": ");
  }
}

export function formatWorkbenchReply(reply, command) {
  const status = reply.status === "committed" ? "Done" : label(reply.status);
  const lines = [status + (reply.error ? " [" + safe(reply.error.code) + "]  " + safe(reply.error.message) : "")];
  const request = reply.status !== "committed" || command?.startsWith("job ") ? reply.requestId : null;
  const context = [["Page", reply.page], ["Side", reply.side], ["Request", request], ["Job status", reply.jobStatus]]
      .filter(([, value]) => value != null).map(([name, value]) => name + ": " + safe(value));
  if (context.length) lines.push(context.join("   "));
  if (reply.error) {
    const {code, message, ...details} = reply.error;
    if (Object.keys(details).length) for (const row of rows(details)) lines.push(row);
  } else if (["help", "commands"].includes(command) && Array.isArray(reply.result)) {
    lines.push(...(reply.result.length ? reply.result.map(row => "  " + safe(row.syntax)) : ["No matching commands."]));
  } else if (command === "page list" && Array.isArray(reply.result)) {
    lines.push(reply.result.length ? "Connected pages" : "No connected pages.");
    for (const page of reply.result) lines.push("  " + [page.id, page.name, page.mode, page.moduleName].filter(Boolean).map(safe).join("  ·  "));
  } else if (["fs ls", "fs complete"].includes(command) && reply.result) {
    const {path, number, total, entries} = reply.result;
    lines.push(safe(path), "Page " + number + " · " + total + " entries");
    for (const entry of entries) lines.push("  " + safe(entry.name) + (entry.directory ? "/" : ""));
  } else if (reply.result != null) {
    for (const row of rows(reply.result)) lines.push(row);
  }
  return lines.join("\n");
}
