"""Shared protocol grammar and receipt vocabulary for the standard-library launcher."""
import errno
import json
import os
import re
import uuid


def token():
    return uuid.uuid4().hex


class CommandError(Exception):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code = code
        self.details = details


def error_info(error):
    if isinstance(error, CommandError):
        return dict(error.details, code=error.code, message=str(error))
    code = errno.errorcode.get(getattr(error, "errno", None), "COMMAND_FAILED")
    return {"code": code, "message": str(error)}


def completed(result, page=None):
    return {"version": 1, "protocolVersion": 1, "status": "committed", "page": page, "pageId": page,
            "side": None, "documentVersion": 0, "result": result}


class Grammar:
    def __init__(self, root):
        with open(os.path.join(root, "src", "contracts", "workbench_commands.json"), encoding="utf8") as stream:
            self.catalogue = json.load(stream)
        self.rows = {row["name"]: row for row in self.catalogue["commands"]}
        self.arity = self.catalogue["optionArity"]

    def parse(self, argv):
        if not isinstance(argv, list) or len(argv) > 150 or any(not isinstance(x, str) for x in argv):
            raise CommandError("INVALID_ARGUMENT", "Invalid argument list")
        opts, words = {}, []
        i = 0
        while i < len(argv):
            item = argv[i]
            i += 1
            if not item.startswith("--"):
                words.append(item)
                continue
            key = item[2:]
            count = self.arity.get(key)
            if count is None or key in opts or i + count > len(argv):
                raise CommandError("INVALID_ARGUMENT", "Invalid or repeated option")
            value = argv[i:i + count]
            if key != "filter" and "" in value:
                raise CommandError("INVALID_ARGUMENT", "Empty option")
            opts[key] = True if count == 0 else value[0] if count == 1 else value
            i += count
        if not words:
            raise CommandError("INVALID_ARGUMENT", "Command required")
        first = words.pop(0)
        name = self.catalogue["aliases"].get(first, first)
        if name not in self.rows and words:
            name += " " + words.pop(0)
        row = self.rows.get(name)
        if not row or row["capability"] != "v1":
            raise CommandError("UNAVAILABLE", "Unavailable command")
        if "side" in opts:
            if opts["side"] not in ("A", "B"):
                raise CommandError("INVALID_ARGUMENT", "Expected side A or B")
            if not row.get("compareSide") and not (name == "commands" and opts.get("available")):
                raise CommandError("INVALID_SIDE", "This command does not target a Compare side")
        for key, digits in (("timeout", 8), ("page-number", 7)):
            if key in opts and not re.fullmatch("[1-9][0-9]{0,%d}" % (digits - 1), opts[key]):
                raise CommandError("INVALID_ARGUMENT", "Invalid " + key)
        for key, allowed in (("view", ("logic", "standard", "search-first")), ("on-conflict", ("abort", "replace"))):
            if key in opts and opts[key] not in allowed:
                raise CommandError("INVALID_ARGUMENT", "Invalid " + key)
        allowed_options = {"page","side","request-id","timeout","async","json"} | set(row.get("options",[]))
        if opts.keys() - allowed_options:
            raise CommandError("INVALID_ARGUMENT", row["syntax"])
        if "text" in opts and "inputStart" in row:
            if len(words) != row["inputStart"] or len(opts["text"].encode()) > 16 * 1024 * 1024:
                raise CommandError("INVALID_ARGUMENT", "Expected a single text input")
            words.append(opts.get("name", "pasted input"))
        if row.get("output") and ("out" in opts or "download" in opts):
            if words or ("out" in opts and "download" in opts):
                raise CommandError("INVALID_ARGUMENT", "Choose one export destination")
            words.append(opts.get("out", "download"))
        minimum, maximum = row["arguments"]
        alt = row.get("alternative")
        if alt and opts.get(alt):
            if words:
                raise CommandError("INVALID_ARGUMENT", row["syntax"])
            minimum = 0
        if len(words) < minimum or len(words) > maximum or (name not in ("fs complete","text set") and "" in words):
            raise CommandError("INVALID_ARGUMENT", row["syntax"])
        for index, allowed in row.get("enums", {}).items():
            index = int(index)
            if index < len(words) and words[index] not in allowed:
                raise CommandError("INVALID_ARGUMENT", row["syntax"])
        return name, words, opts, row
