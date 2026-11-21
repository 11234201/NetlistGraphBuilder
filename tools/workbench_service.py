"""Concurrent workbench mailbox shared by the Python and Windows launchers."""
import hashlib
import json
import os
import re
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

from workbench_protocol import CommandError, completed, error_info, token


class Page:
    def __init__(self, number, name=""):
        self.id = "p%d" % number
        self.name = name
        self.resume = token()
        self.connection = None
        self.seen = 0
        self.context = {}
        self.handles = OrderedDict()
        self.paths = {}

    def describe(self):
        return dict(self.context, id=self.id, name=self.name, online=bool(self.connection))

    def handle(self, path):
        if path in self.paths:
            return self.paths[path]
        if len(self.handles) >= 4096:
            _, old_path = self.handles.popitem(last=False)
            del self.paths[old_path]
        handle = "ngb-file:" + token()
        self.paths[path] = handle
        self.handles[handle] = path
        return handle


class Job:
    def __init__(self, rid, page, fingerprint, selector, side):
        self.id = rid
        self.page = page
        self.key = fingerprint
        self.selector = selector
        self.side = side
        context = page.context if page else {}
        self.version = context.get("documentVersion", 0)
        self.scope = {key: context[key] for key in ("documentId", "graphId", "documentVersion")
                      if context.get(key) is not None}
        self.phase = "reading"
        self.finished = False
        self.at = time.monotonic()
        self.payload = None
        self.result = None
        self.error = None
        self.output = None
        self.preparing = False
        self.interrupt = False

    def receipt(self):
        page = self.page.id if self.page else None
        response = dict(version=1, protocolVersion=1, requestId=self.id, page=page, pageId=page,
                        side=self.side, documentVersion=self.version, status=self.phase)
        response["error" if self.error else "result"] = self.error or self.result
        return response


class WorkbenchService:
    def __init__(self, grammar, files, log):
        self.grammar = grammar
        self.files = files
        self.log = log
        self.pair = token()
        self.pages = {}
        self.jobs = OrderedDict()
        self.expired = OrderedDict()
        self.changed = threading.Condition()
        self.polling = set()
        self.readers = ThreadPoolExecutor(max_workers=4)
        self.stopping = False

    def finish(self, job, phase, result=None, error=None):
        job.phase = phase
        job.result, job.error = result, error
        job.payload = None
        job.finished = True
        job.at = time.monotonic()
        self.changed.notify_all()

    def disconnect(self, page):
        page.connection = None
        page.handles.clear()
        page.paths.clear()
        for job in self.jobs.values():
            if job.page is page and not job.finished and job.phase != "writing":
                self.finish(job, "unknown" if job.phase == "executing" else "cancelled",
                            error={"code":"PAGE_UNAVAILABLE","message":"Page disconnected"})
        self.changed.notify_all()

    def close(self):
        with self.changed:
            self.stopping = True
            for page in self.pages.values():
                self.disconnect(page)
        self.readers.shutdown(wait=True)

    def sweep(self):
        now = time.monotonic()
        for page in self.pages.values():
            if page.connection and now - page.seen > 45:
                self.disconnect(page)
        for rid, job in list(self.jobs.items()):
            if job.finished and not job.preparing and now - job.at > 600:
                del self.jobs[rid]
                self.expired[rid] = None
        while len(self.expired) > 4096:
            self.expired.popitem(last=False)

    def page_for(self, selector):
        live = [page for page in self.pages.values() if page.connection]
        if selector:
            for page in live:
                if selector in (page.id, page.name):
                    return page
        elif len(live) == 1:
            return live[0]
        code = "PAGE_UNAVAILABLE" if selector else "PAGE_REQUIRED" if live else "PAGE_NOT_CONNECTED"
        raise CommandError(code, "Choose a connected page", candidates=[p.id for p in live])

    def new_page(self, name=""):
        if len(self.pages) >= 2048:
            raise CommandError("PAGE_LIMIT", "Page limit reached")
        page = Page(len(self.pages) + 1, name)
        self.pages[page.id] = page
        return page

    def lookup(self, rid):
        if rid in self.expired:
            raise CommandError("REQUEST_EXPIRED", "The receipt retention period has ended")
        if rid not in self.jobs:
            raise CommandError("UNKNOWN_REQUEST", "Unknown request")
        return self.jobs[rid]

    def validate_name(self, name, owner=None):
        if not name or re.fullmatch("p[0-9]+", name) or any(p is not owner and p.name == name for p in self.pages.values()):
            raise CommandError("NAME_CONFLICT", "Page name is empty, reserved or already in use")

    def session_change(self, name, args, opts):
        if name == "page rename":
            page = self.page_for(args[0])
            self.validate_name(args[1], page)
            page.name = args[1]
            self.changed.notify_all()
            return completed(page.describe(), page.id)
        if "name" in opts:
            self.validate_name(opts["name"])
        page = self.new_page(opts.get("name",""))
        return completed({"id":page.id, "href":"/#ngb=%s&page=%s&resume=%s" % (self.pair,page.id,page.resume)}, page.id)

    def available(self, selector, opts):
        page = None
        if selector or opts.get("side") or any(p.connection for p in self.pages.values()):
            page = self.page_for(selector)
        mode = page.context.get("mode") if page else None
        if opts.get("side") and mode != "Compare":
            raise CommandError("INVALID_SIDE", "Only a Compare page has sides A and B")
        rows = []
        for row in self.grammar.rows.values():
            if row["capability"] != "v1":
                continue
            if row["target"] != "page":
                if not opts.get("side"):
                    rows.append(row)
                continue
            if not page or ("modes" in row and mode not in row["modes"]):
                continue
            if opts.get("side") and not row.get("compareSide"):
                continue
            if not opts.get("side") and mode == "Compare" and row.get("compareSide") == "required":
                continue
            if "pickerStates" in row and page.context.get("pickerState","closed") not in row["pickerStates"]:
                continue
            rows.append(row)
        return completed(rows, page.id if page else None)

    def filesystem_command(self, name, args, opts, cwd):
        if name == "fs roots":
            return completed(self.files.roots)
        if name == "fs pwd":
            return completed({"path":cwd})
        target = os.path.abspath(os.path.join(cwd, args[0] if args else "."))
        query = opts.get("filter","")
        if name == "fs complete" and args[0] and not args[0].endswith(("/",os.sep)):
            target, query = os.path.split(target)
        # Directory scans on slow mounts must not hold the page/job registry lock.
        self.changed.release()
        try:
            listing = self.files.list(target, query, int(opts.get("page-number",1)), False, name == "fs complete")
        finally:
            self.changed.acquire()
        return completed({"path": listing["path"]} if name == "fs cd" else listing)

    def job_capacity(self):
        if len(self.jobs) >= 2048 or sum(j.preparing or not j.finished for j in self.jobs.values()) >= 64:
            raise CommandError("QUEUE_FULL", "Workbench queue is full")

    def command(self, message, browser=None):
        name, args, opts, row = self.grammar.parse(message.get("argv"))
        selector = browser.id if browser else opts.get("page") or message.get("page") or ""
        cwd = self.files.roots[0] if browser else os.path.abspath(message.get("cwd") or os.getcwd())
        if name == "commands" and opts.get("available"):
            try:
                return self.available(selector, opts)
            except CommandError as error:
                self.log.write("error","workbench.catalogue_failed","Could not get commands",error=error,
                               operation=name,code=error.code,page=selector,side=opts.get("side"),
                               requestId=opts.get("request-id") or message.get("id"))
                raise
        if name in ("help", "commands"):
            prefix = " ".join(args)
            return completed([r for r in self.grammar.rows.values() if r["name"].startswith(prefix)])
        if name in ("start", "stop", "status", "quit", "cmd"):
            raise CommandError("INVALID_ARGUMENT", "Use this command at the launcher or prompt")
        if name == "page list":
            return completed([p.describe() for p in self.pages.values() if p.connection])
        rid = opts.get("request-id") or message.get("id") or token()
        if not isinstance(rid,str) or not rid:
            raise CommandError("INVALID_ARGUMENT","Invalid request ID")
        if name in ("page new","page rename"):
            if "request-id" not in opts:
                return self.session_change(name,args,opts)
            key = digest(["session", name, args, opts.get("name")])
            if rid in self.jobs or rid in self.expired:
                previous = self.lookup(rid)
                if previous.key != key:
                    raise CommandError("REQUEST_CONFLICT","Request ID reused")
                return previous.receipt()
            self.job_capacity()
            job = self.jobs[rid] = Job(rid, None, key, "", None)
            try:
                response = self.session_change(name,args,opts)
                job.page = self.pages[response["page"]]
                self.finish(job, "committed", response["result"])
            except Exception as error:
                self.record(job, name, error, "workbench.page_failed")
                self.finish(job, "failed", error=error_info(error))
            return job.receipt()
        if name.startswith("page "):
            p = self.pages.get(args[0])
            if name == "page wait" and p and not p.connection:
                return {"version":1, "protocolVersion":1, "status":"waiting", "page":p.id}
            p = self.page_for(args[0])
            return completed(p.describe(), p.id)
        if name.startswith("job "):
            job = self.lookup(args[0])
            if name == "job cancel" and not job.finished:
                if job.phase in ("executing","writing"):
                    raise CommandError("ALREADY_EXECUTING","Page has begun applying this command")
                self.finish(job,"cancelled",error={"code":"CANCELLED","message":"Cancelled before execution"})
            return job.receipt()
        if name.startswith("fs "):
            return self.filesystem_command(name,args,opts,cwd)
        if rid in self.expired:
            self.lookup(rid)
        previous = self.jobs.get(rid)
        if previous:
            p = previous.page
            if not p or (selector != previous.selector and selector != p.id and (not selector or selector != p.name)):
                raise CommandError("REQUEST_CONFLICT","Request ID already used for another target")
        else:
            p = browser or self.page_for(selector)
        semantic = {k:v for k,v in opts.items() if k not in ("request-id","page","async","timeout","json")}
        key = digest([p.id,cwd,name,args,semantic])
        if previous:
            if previous.key != key:
                raise CommandError("REQUEST_CONFLICT","Request ID already used with different arguments")
            return previous.receipt()
        self.job_capacity()
        job = Job(rid, p, key, selector, opts.get("side"))
        job.interrupt = bool(row.get("interrupt"))
        if row.get("output") and not opts.get("download") and (opts.get("out") or args[-1] != "download"):
            if browser:
                raise CommandError("ACCESS_DENIED","Use the terminal for server output")
            job.output = os.path.abspath(os.path.join(cwd,args[-1])), bool(opts.get("overwrite"))
        self.jobs[rid] = job
        if opts.get("async") and "inputStart" in row:
            job.preparing = True
            self.readers.submit(self.prepare, job, row, name, args, opts, cwd, browser)
        else:
            self.changed.release()
            try:
                self.prepare(job, row, name, args, opts, cwd, browser)
            finally:
                self.changed.acquire()
        return job.receipt()

    def record(self, job, name, error, event, **details):
        self.log.write("error", event, name + " failed", error=error,
                       code=error_info(error)["code"], operation=name, requestId=job.id,
                       page=job.page.id if job.page else None, side=job.side, **job.scope, **details)

    def prepare(self, job, row, name, args, opts, cwd, browser):
        try:
            inputs = self.inputs(job,row,name,args,opts,cwd,browser) if "inputStart" in row else []
            with self.changed:
                if not job.finished:
                    job.payload = self.payload(job,name,args,opts,inputs)
                    job.phase = "queued"
        except Exception as error:
            with self.changed:
                if not job.finished:
                    self.record(job, name, error, "workbench.prepare_failed")
                    self.finish(job,"failed",error=error_info(error))
        finally:
            with self.changed:
                job.preparing = False
                self.changed.notify_all()

    def payload(self,job,name,args,opts,files):
        row = self.grammar.rows[name]
        data = {"id":job.id, "name":name, "args":args, "opts":{k:v for k,v in opts.items() if k != "text"},
                "files":files, "output":bool(row.get("output"))}
        if "modes" in row:
            data["modes"] = row["modes"]
        return data

    def inputs(self, job, row, name, args, opts, cwd, browser):
        inputs, size = [], 0
        paths = args[row["inputStart"]:]
        for index, arg in enumerate(paths):
            with self.changed:
                if job.finished:
                    break
                path = browser.handles.get(arg) if browser and arg.startswith("ngb-file:") else os.path.join(cwd,arg)
                names = [os.path.basename(browser.handles.get(a,a) if browser else a) for a in paths]
            try:
                if not path:
                    raise CommandError("ACCESS_DENIED","File selection expired")
                source = {"name":arg,"text":opts["text"]} if "text" in opts else self.files.read(path,bool(browser))
                size += len(source["text"].encode())
                if size > 24 * 1024 * 1024:
                    raise CommandError("FILE_LIMIT","Input batch too large")
                inputs.append(source)
            except Exception as error:
                detail = error_info(error)
                if name == "files import" and detail["code"] not in ("ACCESS_DENIED","FILE_LIMIT"):
                    self.record(job, name, error, "workbench.read_failed", fileName=names[index])
                    inputs.append({"name":names[index],"error":detail})
                elif name == "aig add" or (name == "design add" and job.page.context.get("mode") == "AIG"):
                    raise CommandError(detail["code"],detail["message"],files=[
                        {"name":basename,"status":"failed" if i == index else "uncommitted"} for i,basename in enumerate(names)]) from error
                else:
                    raise
        return inputs

    def check_document(self, job, p):
        version = p.context.get("documentVersion")
        if not version or not job.version or job.version == version:
            return True
        if job.payload["name"] in ("design info","module list","search find","timing show","files browse","files choose","files cancel"):
            return True
        self.finish(job,"failed",error={"code":"STALE_DOCUMENT","message":"Target document changed before execution"})
        return False

    def handle(self, b, admin):
        if not isinstance(b,dict) or b.get("version") != 1:
            raise CommandError("PROTOCOL_VERSION","Expected protocol version 1")
        with self.changed:
            self.sweep()
            op = b.get("op")
            if self.stopping:
                raise CommandError("SERVER_STOPPING","Service is stopping")
            if admin:
                if op == "command":
                    result = self.command(b)
                    result.setdefault("requestId",b.get("id") or token())
                    return result
                if op == "status":
                    return self.lookup(b.get("id")).receipt()
                raise CommandError("INVALID_ARGUMENT","Unknown control operation")
            if op == "join":
                if b.get("token") != self.pair:
                    raise CommandError("ACCESS_DENIED","Pair this browser")
                p = self.pages.get(b.get("page"))
                if not p or p.resume != b.get("resume") or (p.connection and not b.get("reload")):
                    p = self.new_page()
                else:
                    self.disconnect(p)
                p.context = {}  # Document versions start again in the new browser connection.
                p.connection = token()
                p.seen = time.monotonic()
                return {"page":p.id, "connection":p.connection, "resume":p.resume, "cancelLane":True}
            p = self.pages.get(b.get("page"))
            if not p or not p.connection or p.connection != b.get("connection"):
                raise CommandError("PAGE_UNAVAILABLE","Page connection expired")
            p.seen = time.monotonic()
            if op == "leave":
                self.disconnect(p)
                return {}
            if op == "pulse":
                return {}
            if op == "list":
                self.changed.release()
                try:
                    listing = self.files.list(b.get("path"), b.get("filter",""), b.get("number",1))
                finally:
                    self.changed.acquire()
                if p.connection != b.get("connection"):
                    raise CommandError("PAGE_UNAVAILABLE","Page connection expired")
                for entry in listing["entries"]:
                    if not entry["directory"]:
                        entry["handle"] = p.handle(os.path.join(listing["path"],entry["name"]))
                return listing
            if op == "import":
                name, _, opts, row = self.grammar.parse(b.get("argv"))
                if "inputStart" not in row or (opts.get("page") and opts["page"] != p.id):
                    raise CommandError("ACCESS_DENIED","Invalid picker action")
                return self.command(b,p)
            if op == "poll":
                self.update_context(b,p)
                return self.poll(b,p)
            job = self.lookup(b.get("id"))
            if job.page is not p:
                raise CommandError("ACCESS_DENIED","Job belongs to another page")
            if op == "status":
                return job.receipt()
            if op == "inputs" and job.phase in ("delivered","executing"):
                return {"files":job.payload["files"]}
            if op == "grant":
                if job.phase != "executing":
                    self.update_context(b,p)
                granted = job.phase == "executing" or (job.phase == "delivered" and self.check_document(job,p))
                if granted:
                    job.phase = "executing"
                return {"granted":granted}
            if op == "picker-files" and job.phase == "executing" and job.payload["name"] == "files submit":
                name,args,opts,row = self.grammar.parse(b.get("argv"))
                if "inputStart" not in row or "text" in opts or opts.get("page",p.id) != p.id:
                    raise CommandError("ACCESS_DENIED","Invalid picker action")
                self.changed.release()
                try:
                    files = self.inputs(job,row,name,args,opts,self.files.roots[0],p)
                except Exception as error:
                    self.record(job, name, error, "workbench.prepare_failed")
                    raise
                finally:
                    self.changed.acquire()
                if job.finished or p.connection != b.get("connection"):
                    raise CommandError("PAGE_UNAVAILABLE","Page connection expired")
                return self.payload(job,name,args,opts,files)
            if op == "ack":
                if job.phase == "writing":
                    self.changed.wait_for(lambda: job.finished)
                if job.finished:
                    return job.receipt()
                if job.phase == "executing":
                    self.update_context(b,p)
                    return self.ack(job,b,p)
            raise CommandError("INVALID_STATE","Unexpected page operation")

    @staticmethod
    def update_context(body,page):
        context = body.get("context")
        if isinstance(context,dict):
            previous = page.context.get("documentVersion",0)
            version = context.get("documentVersion",0)
            if not isinstance(version,int) or version < previous:
                return
            fields = ("mode", "source", "documentVersion", "moduleName", "occurrence", "pair",
                      "activeSide", "graphId", "documentId")
            page.context = {key:context[key] for key in fields if key in context}
            picker = context.get("pickerState")
            page.context["pickerState"] = picker if picker in ("open", "selected", "busy") else "closed"

    def poll(self,b,p):
        lane = b.get("lane")
        if lane not in (None,"cancel","work"):
            raise CommandError("INVALID_ARGUMENT","Invalid poll lane")
        key = (p.id,lane)
        def next_job():
            return next((j for j in self.jobs.values() if j.page is p and not j.finished and
                         (lane is None or j.interrupt == (lane == "cancel"))),None)
        job = next_job()
        wait = min(8, max(0, int(b.get("waitMs") or 0) / 1000.0))
        if (not job or job.phase == "reading") and wait and key not in self.polling and len(self.polling) < 16:
            self.polling.add(key)
            try:
                def deliverable():
                    queued = next_job()
                    return p.connection != b["connection"] or (queued and queued.phase != "reading")
                self.changed.wait_for(deliverable, wait)
            finally:
                self.polling.discard(key)
            if p.connection != b["connection"]:
                raise CommandError("PAGE_UNAVAILABLE","Page connection expired")
            job = next_job()
        if not job or job.phase not in ("queued","delivered") or not self.check_document(job,p):
            return {"name":p.name}
        job.phase = "delivered"
        return {"name":p.name, "job":dict(job.payload, hasInputs=bool(job.payload["files"]), files=[])}

    def ack(self,job,b,p):
        job.version = p.context.get("documentVersion", job.version)
        result = b.get("result")
        error = b.get("error")
        if not error and job.output:
            job.phase = "writing"
            self.changed.release()
            try:
                result = self.files.output(job.output[0],result["text"],job.output[1])
            except Exception as exc:
                self.record(job, job.payload["name"], exc, "workbench.export_failed")
                error = error_info(exc)
            finally:
                self.changed.acquire()
        if error:
            status = "cancelled" if error.get("code") == "CANCELLED" else "failed"
        else:
            status = "partial" if isinstance(result,dict) and result.get("partial") else "committed"
        self.finish(job,status,result,error)
        return job.receipt()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
