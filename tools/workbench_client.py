"""Independent CLI/Tcl and interactive workbench client."""
import json
import os
import re
import sys
import time
from collections import deque

from workbench_protocol import CommandError, error_info, token
from workbench_transport import control_call, encode
from workbench_display import format_reply


def execute(run, grammar, argv, context, parsed=None):
    name, _, opts, _ = parsed or grammar.parse(argv)
    rid = opts.get("request-id", token())
    message = {"version":1,"op":"command","id":rid,"argv":argv,"page":context.get("page"),"cwd":context["cwd"]}
    response = run(message)
    deadline = time.monotonic() + int(opts.get("timeout",90000)) / 1000.0
    pending = ("reading","queued","delivered","executing","writing")
    while not opts.get("async") and name not in ("job status","job cancel"):
        status = response.get("status")
        if status != "waiting" and status not in pending:
            break
        if time.monotonic() >= deadline:
            return dict(response, status="failed", jobStatus=status,
                        error={"code":"WAIT_TIMEOUT","message":"Timed out waiting for " + rid})
        time.sleep(0.08)
        response = run(message if status == "waiting" else {"version":1,"op":"status","id":response["requestId"]})
    if response.get("status") == "committed":
        if name == "page use":
            context["page"] = response["page"]
        if name == "fs cd":
            context["cwd"] = response["result"]["path"]
    return response


def tcl(value):
    def word(s):
        if not s:
            return "{}"
        escaped = {"\n":r"\n","\r":r"\r","\t":r"\t"}
        return "".join(escaped.get(c,"\\" + c if c.isspace() or c in '\\{}[]$";' else c) for c in s)
    if isinstance(value,dict):
        return " ".join(word(tcl(x)) for pair in value.items() for x in pair)
    if isinstance(value,list):
        return " ".join(word(tcl(x)) for x in value)
    if value is None:
        return ""
    if isinstance(value,bool):
        return "true" if value else "false"
    return str(value)


def input_bytes(limit):
    data = sys.stdin.buffer.read(limit + 1)
    if len(data) > limit:
        raise CommandError("FILE_LIMIT","Input too large")
    return data


def prompt_options(args, grammar):
    words = []
    json_output = inline_text = False
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--json":
            json_output = True
        if arg == "--text":
            inline_text = True
        if not arg.startswith("--") and len(words) < 2:
            words.append(arg)
        i += 1 + (grammar.arity.get(arg[2:], 0) if arg.startswith("--") else 0)
    remember = bool(args) and not inline_text and words[:1] != ["text set"] and words != ["text", "set"]
    return json_output, remember


def cli(argv, grammar, read_state, log):
    args = []
    machine = encoded = False
    json_output, command = not sys.stdout.isatty(), None
    path = None
    try:
        it = iter(argv)
        for arg in it:
            if arg == "--state-file":
                path = next(it, None)
            elif arg == "--tcl":
                machine = True
            elif arg == "--argv-stdin":
                encoded = True
            else:
                args.append(arg)
                for _ in range(grammar.arity.get(arg[2:],0) if arg.startswith("--") else 0):
                    value = next(it,None)
                    if value is not None:
                        args.append(value)
        json_output = json_output or prompt_options(args, grammar)[0]
        if not path:
            raise CommandError("INVALID_ARGUMENT","A state file is required")
        state = read_state(path)
        if encoded:
            if args:
                raise CommandError("INVALID_ARGUMENT","Tcl input cannot be mixed with command arguments")
            for match in re.finditer(rb"\S+",input_bytes(32*1024*1024+65536)):
                data = match.group()
                if len(args) >= 150 or not data.startswith(b"x") or len(data) % 2 != 1:
                    raise CommandError("INVALID_ARGUMENT","Invalid Tcl argument")
                try:
                    args.append(bytes.fromhex(data[1:].decode("ascii")).decode("utf8"))
                except ValueError as error:
                    raise CommandError("INVALID_ARGUMENT","Invalid Tcl argument") from error
        i = 0
        while i < len(args):
            item = args[i]
            if item == "--stdin":
                if encoded:
                    raise CommandError("INVALID_ARGUMENT","Standard input already contains Tcl arguments")
                args[i:i+1] = ["--text",input_bytes(16*1024*1024).decode("utf8")]
                i += 2
            else:
                i += 1 + (grammar.arity.get(item[2:],0) if item.startswith("--") else 0)
        parsed = grammar.parse(args)
        command = parsed[0]
        reply = execute(lambda body: control_call(state,body), grammar,args,{"cwd":os.getcwd()}, parsed)
    except Exception as error:
        detail = error_info(error)
        log.write("error","workbench.client_failed","Command failed",error=error,operation="cmd",code=detail["code"])
        reply = {"version":1,"status":"failed","error":detail}
    if machine or json_output:
        sys.stdout.buffer.write((tcl(reply).encode("utf8") if machine else encode(reply)) + b"\n")
        sys.stdout.flush()
    else:
        print(format_reply(reply, command), flush=True)
    return int(not machine and reply.get("status") in ("failed","unknown","cancelled"))


def words(line, partial=False, tail=False):
    items, word, quote, started = [], "", "", False
    i, start = 0, 0
    while i < len(line):
        c = line[i]
        i += 1
        if not started and not c.isspace():
            start = i - 1
        if quote and c == quote:
            quote = ""
        elif not quote and c.isspace():
            if started:
                items.append(word)
            word, started = "", False
        elif not quote and c in ("'",'"'):
            started, quote = True, c
        else:
            if c == "\\" and i < len(line) and (line[i].isspace() or line[i] in "'\"\\"):
                c = line[i]
                i += 1
            word += c
            started = True
    if quote and not partial:
        raise CommandError("INVALID_ARGUMENT","Unterminated quote")
    if started:
        items.append(word)
    if tail:
        return (start,word) if started else (len(line),"")
    return items


def complete_path(run, grammar, context, word):
    response = execute(run, grammar, ["fs","complete",word], context)
    base = word[:max(word.rfind("/"),word.rfind(os.sep))+1]
    return [base + entry["name"] + ("/" if entry["directory"] else "")
            for entry in response.get("result",{}).get("entries",[])]


def quote_word(word):
    return re.sub(r"""([\s\\"'])""",r"\\\1",word)


def windows_input(prompt, run, grammar, context, history):
    import msvcrt
    line, cursor = "", 0
    position, draft = len(history), ""
    while True:
        previous = len(line)
        key = msvcrt.getwch()
        if key in ("\r","\n"):
            sys.stderr.write("\n")
            return line
        if key in ("\x03","\x1a"):
            raise EOFError
        if key in ("\x00","\xe0"):
            extended = msvcrt.getwch()
            if extended == "H" and position:
                if position == len(history):
                    draft = line
                position -= 1
                line = history[position]
                cursor = len(line)
            elif extended == "P" and position < len(history):
                position += 1
                line = draft if position == len(history) else history[position]
                cursor = len(line)
            elif extended == "K":
                cursor = max(0,cursor-1)
            elif extended == "M":
                cursor = min(len(line),cursor+1)
            elif extended == "G":
                cursor = 0
            elif extended == "O":
                cursor = len(line)
            elif extended == "S":
                line = line[:cursor] + line[cursor+1:]
        elif key == "\b":
            if cursor:
                cursor -= 1
                line = line[:cursor] + line[cursor+1:]
        elif key == "\t":
            before = line[:cursor]
            # The lexer tracks quoting/escaping, so paths containing spaces are one completion word.
            start, word = words(before,True,tail=True)
            paths = complete_path(run,grammar,context,word)
            if paths:
                completion = os.path.commonprefix(paths)
                if len(completion) > len(word) or len(paths) == 1:
                    replacement = quote_word(completion)
                    line = before[:start] + replacement + line[cursor:]
                    cursor = start + len(replacement)
                else:
                    sys.stderr.write("\n" + "  ".join(paths) + "\n")
        elif key >= " ":
            line = line[:cursor] + key + line[cursor:]
            cursor += 1
        sys.stderr.write("\r" + prompt + line + " " * max(0,previous-len(line)) + "\r" + prompt + line[:cursor])
        sys.stderr.flush()


def terminal(run, grammar, stop, log):
    context = {"cwd":os.getcwd()}
    terminal_input = sys.stdin.isatty()
    history = deque(maxlen=100)
    try:
        import readline
        candidates = []
        def complete(text, index):
            if index == 0:
                prefix = (words(text, True) or [""])[0]
                candidates[:] = [quote_word(path) for path in complete_path(run,grammar,context,prefix)]
            return candidates[index] if index < len(candidates) else None
        readline.set_completer_delims(" \t\n")
        readline.set_completer(complete)
        readline.parse_and_bind("tab: complete")
        if hasattr(readline,"set_auto_history"):
            readline.set_auto_history(False)
    except ImportError:
        readline = None
    while True:
        prompt = ("ngb[%s]> " % context["page"]) if context.get("page") else "ngb> "
        sys.stderr.write(prompt)
        sys.stderr.flush()
        json_output, command = False, None
        try:
            line = windows_input(prompt,run,grammar,context,history) if os.name == "nt" and terminal_input else input()
            argv = words(line)
            json_output, remember = prompt_options(argv, grammar)
            if argv == ["quit"]:
                stop()
                return
            if argv:
                if terminal_input and remember and (not history or line != history[-1]):
                    history.append(line)
                    if readline and os.name != "nt":
                        readline.add_history(line)
                        if readline.get_current_history_length() > history.maxlen:
                            readline.remove_history_item(0)
                parsed = grammar.parse(argv)
                command = parsed[0]
                response = execute(run,grammar,argv,context,parsed)
                print(encode(response).decode() if json_output else format_reply(response, command), file=sys.stderr, flush=True)
        except EOFError:
            return
        except Exception as error:
            reply = {"status":"failed","error":error_info(error)}
            if not getattr(error, "diagnostic_recorded", False):
                log.write("error", "workbench.prompt_failed", "Interactive command failed", error=error,
                          operation=command or "prompt", page=context.get("page"), code=reply["error"]["code"], console=False)
            print(json.dumps(reply,ensure_ascii=False) if json_output else format_reply(reply,command),file=sys.stderr,flush=True)
