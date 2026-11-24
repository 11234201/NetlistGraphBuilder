"""Human-readable terminal receipts for the Python and packaged Windows launchers."""
import re


def safe(value):
    return re.sub(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]", lambda m: "\\u%04x" % ord(m[0]), str(value))


def label(key):
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", safe(key)).replace("_", " ").replace("-", " ")
    return words[:1].upper() + words[1:]


def format_prompt_startup(ready):
    return ("Open workbench: " + safe(ready["pairUrl"]) + "\nState file: " + safe(ready["stateFile"]) +
            "\nType help to list commands. Use ↑ and ↓ for history.")


def rows(value, indent="", prefix=""):
    if not isinstance(value, (list, dict)):
        text = "—" if value is None else str(value).lower() if isinstance(value, bool) else safe(value)
        yield indent + prefix + text.replace("\n", "\n" + indent + "  ")
    elif not value:
        yield indent + prefix + "(none)"
    else:
        if prefix:
            yield indent + prefix.rstrip()
            indent += "  "
        for key, item in (enumerate(value) if isinstance(value, list) else value.items()):
            yield from rows(item, indent, "- " if isinstance(value, list) else label(key) + ": ")


def format_reply(reply, command=None):
    status = "Done" if reply["status"] == "committed" else label(reply["status"])
    error, result = reply.get("error"), reply.get("result")
    lines = [status + (" [" + safe(error["code"]) + "]  " + safe(error["message"]) if error else "")]
    context = [name + ": " + safe(reply[key]) for name, key in
               (("Page", "page"), ("Side", "side"), ("Request", "requestId"), ("Job status", "jobStatus"))
               if reply.get(key) is not None and (key != "requestId" or status != "Done" or (command or "").startswith("job "))]
    if context:
        lines.append("   ".join(context))
    if error:
        for key, value in error.items():
            if key not in ("code", "message"):
                lines.extend(rows(value, prefix=label(key) + ": "))
    elif command in ("help", "commands") and isinstance(result, list):
        lines.extend(("  " + safe(row["syntax"]) for row in result) if result else ["No matching commands."])
    elif command == "page list" and isinstance(result, list):
        lines.append("Connected pages" if result else "No connected pages.")
        for page in result:
            lines.append("  " + "  ·  ".join(safe(page[key]) for key in ("id", "name", "mode", "moduleName") if page.get(key)))
    elif command in ("fs ls", "fs complete") and result:
        lines.extend([safe(result["path"]), "Page %s · %s entries" % (result["number"], result["total"])])
        lines.extend("  " + safe(entry["name"]) + ("/" if entry["directory"] else "") for entry in result["entries"])
    elif result is not None:
        lines.extend(rows(result))
    return "\n".join(lines)
