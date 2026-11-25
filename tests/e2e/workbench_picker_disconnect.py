"""Pause the real Python picker transport at its injected file-read boundary."""
import io
import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from email.message import Message
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from workbench_protocol import Grammar
from workbench_service import WorkbenchService
from workbench_transport import handle_post


def verify(read_fails):
    entered, finish = threading.Event(), threading.Event()
    def read(*_):
        entered.set()
        if not finish.wait(5):
            raise AssertionError("picker read was not released")
        if read_fails:
            raise OSError("late test read failure")
        return {"name":"one.v", "text":"fixture"}
    log = Mock()
    service = WorkbenchService(Grammar(str(ROOT)), SimpleNamespace(roots=[str(ROOT)], read=read), log)
    try:
        page = service.handle({"version":1,"op":"join","token":service.pair}, False)
        def browser(op, **fields):
            return service.handle(dict(page, version=1, op=op, **fields), False)
        job = service.handle({"version":1, "op":"command", "argv":["files","submit"], "page":page["page"]}, True)
        browser("poll")
        assert browser("grant", id=job["requestId"])["granted"]
        payload = json.dumps(dict(page, version=1, op="picker-files", id=job["requestId"],
                                  argv=["files","import","one.v","two.v"])).encode()
        headers = Message()
        for key, value in {"Host":"localhost", "Origin":"http://localhost", "Content-Type":"application/json",
                           "Content-Length":str(len(payload))}.items():
            headers[key] = value
        handler = Mock(path="/__ngb/workbench", headers=headers, rfile=io.BytesIO(payload), wfile=io.BytesIO(),
                       server=SimpleNamespace(dispatch=service.handle, log=log))
        with ThreadPoolExecutor(max_workers=1) as executor:
            running = executor.submit(handle_post, handler)
            try:
                assert entered.wait(5), "picker never began the read"
                browser("leave")
            finally:
                finish.set()
            running.result(5)
        response = json.loads(handler.wfile.getvalue().decode())
        assert response["error"]["code"] == "CANCELLED" and response["requestId"] == job["requestId"]
        assert response["page"] == page["page"] and "files" not in response
        handler.send_response.assert_called_once_with(400)
        log.write.assert_not_called()
    finally:
        finish.set()
        service.close()


if __name__ == "__main__":
    for read_fails in (False, True):
        verify(read_fails)
