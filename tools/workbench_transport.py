"""Bounded browser HTTP and an independent current-user control endpoint."""
import http.client
import json
import os
import socket
import socketserver
import struct
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit

from workbench_protocol import CommandError, error_info, token

MAX_BODY = 32 * 1024 * 1024


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",",":")).encode("utf8")


class ConcurrentServer(socketserver.ThreadingMixIn):
    daemon_threads = False
    request_queue_size = 32

    def server_activate(self):
        self.slots = threading.BoundedSemaphore(32)
        super().server_activate()

    def process_request(self, request, address):
        if not self.slots.acquire(False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            request.settimeout(15)
            super().process_request_thread(request,address)
        finally:
            self.slots.release()


class BrowserServer(ConcurrentServer, HTTPServer):
    pass


def handle_post(handler, admin=False):
    message = {}
    try:
        if not admin:
            origin = urlsplit(handler.headers.get("Origin",""))
            if (handler.path != "/__ngb/workbench" or handler.headers.get_content_type() != "application/json"
                    or origin.scheme != "http" or origin.netloc != handler.headers.get("Host")):
                raise CommandError("ACCESS_DENIED","Invalid request origin or method")
        size = int(handler.headers.get("Content-Length","0"))
        if size <= 0 or size > MAX_BODY or handler.headers.get("Transfer-Encoding"):
            raise CommandError("REQUEST_LIMIT","Expected a bounded JSON request")
        message = json.loads(handler.rfile.read(size).decode("utf8"))
        data = handler.server.dispatch(message, admin)
        status = 200
    except Exception as exc:
        detail = error_info(exc)
        if isinstance(exc, (ValueError,UnicodeError)) and not isinstance(exc,CommandError):
            detail = {"code":"INVALID_ARGUMENT","message":"Invalid JSON request"}
        data = {"version":1, "status":"failed", "error":detail}
        if isinstance(message,dict):
            data["requestId"] = message.get("id")
            data["page"] = message.get("page")
            if message.get("op") in ("list", "picker-files") and detail["code"] != "CANCELLED":
                handler.server.log.write("error","workbench.files_failed","File request failed",error=exc,
                                         operation=message["op"],code=detail["code"],page=message.get("page"),
                                         requestId=message.get("id"))
        status = 400
    body = encode(data)
    handler.send_response(status)
    handler.send_header("Content-Type","application/json")
    handler.send_header("Cache-Control","no-store")
    handler.send_header("Content-Length",str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class ControlHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        handle_post(self, True)

    def log_message(self, *args):
        pass


if os.name == "nt":
    from ctypes import WinDLL, byref, c_void_p, create_string_buffer, get_last_error, sizeof, WinError
    from ctypes import wintypes
    from multiprocessing.connection import Client, Listener

    def windows_api(dll, name, result, *arguments):
        function = getattr(WinDLL(dll, use_last_error=True),name)
        function.restype = result
        function.argtypes = arguments
        return function

    def require(ok):
        if not ok:
            raise WinError(get_last_error())

    def client_is_owner(pipe):
        # Query TokenUser while impersonating the pipe client. Revert before doing any file or command work.
        from ctypes import POINTER, cast
        handle, dword, boolean = wintypes.HANDLE, wintypes.DWORD, wintypes.BOOL
        process = windows_api("kernel32","GetCurrentProcess",handle)
        thread = windows_api("kernel32","GetCurrentThread",handle)
        close = windows_api("kernel32","CloseHandle",boolean,handle)
        process_token = windows_api("advapi32","OpenProcessToken",boolean,handle,dword,POINTER(handle))
        thread_token = windows_api("advapi32","OpenThreadToken",boolean,handle,dword,boolean,POINTER(handle))
        info = windows_api("advapi32","GetTokenInformation",boolean,handle,dword,c_void_p,dword,POINTER(dword))
        equal = windows_api("advapi32","EqualSid",boolean,c_void_p,c_void_p)
        impersonate = windows_api("advapi32","ImpersonateNamedPipeClient",boolean,handle)
        revert = windows_api("advapi32","RevertToSelf",boolean)
        def user(token_handle):
            size = dword()
            info(token_handle,1,None,0,byref(size))
            if not size.value:
                raise WinError(get_last_error())
            buffer = create_string_buffer(size.value)
            require(info(token_handle,1,buffer,size.value,byref(size)))
            return buffer
        own, peer = handle(), handle()
        require(process_token(process(),8,byref(own)))
        try:
            require(impersonate(pipe))
            try:
                require(thread_token(thread(),8,True,byref(peer)))
            finally:
                require(revert())
            user1, user2 = user(own), user(peer)
            return bool(equal(cast(user1,POINTER(c_void_p))[0],cast(user2,POINTER(c_void_p))[0]))
        finally:
            close(own)
            if peer.value:
                close(peer)

    def pipe_control_call(state, message):
        from ctypes import POINTER
        with Client(state["control"],family="AF_PIPE") as client:
            pid = wintypes.DWORD()
            getpid = windows_api("kernel32","GetNamedPipeServerProcessId",wintypes.BOOL,wintypes.HANDLE,POINTER(wintypes.DWORD))
            require(getpid(client.fileno(),byref(pid)))
            if pid.value != state["pid"]:
                raise CommandError("NO_CONTROL","Control endpoint ownership changed")
            client.send_bytes(encode(message))
            if not client.poll(20):
                raise CommandError("WAIT_TIMEOUT","Control endpoint timed out")
            return json.loads(client.recv_bytes(MAX_BODY).decode("utf8"))

    class ControlEndpoint:
        def __init__(self, directory, dispatch, log):
            self.path = r"\\.\pipe\ngb-" + token()
            self.listener = Listener(self.path,family="AF_PIPE")
            self.dispatch = dispatch
            self.log = log
            self.closed = False
            self.slots = threading.BoundedSemaphore(16)
            self.thread = threading.Thread(target=self.serve,daemon=True)
            self.thread.start()

        def serve(self):
            while not self.closed:
                try:
                    client = self.listener.accept()
                except OSError:
                    if self.closed:
                        break
                    raise
                if self.closed or not self.slots.acquire(False):
                    client.close()
                else:
                    threading.Thread(target=self.handle,args=(client,),daemon=True).start()

        def handle(self, client):
            with client:
                try:
                    if not client.poll(15):
                        return
                    message = json.loads(client.recv_bytes(MAX_BODY).decode("utf8"))
                    if not client_is_owner(client.fileno()):
                        raise CommandError("ACCESS_DENIED","Current user access required")
                    result = self.dispatch(message, True)
                except Exception as error:
                    result = {"version":1, "status":"failed", "error":error_info(error)}
                finally:
                    self.slots.release()
                try:
                    client.send_bytes(encode(result))
                except OSError:
                    pass

        def close(self):
            self.closed = True
            with Client(self.path,family="AF_PIPE"):
                pass
            self.thread.join(timeout=2)
            self.listener.close()
else:
    class UnixControlServer(ConcurrentServer, socketserver.UnixStreamServer):
        pass

    class ControlEndpoint:
        def __init__(self, directory, dispatch, log):
            self.path = os.path.join(directory,"control")
            self.server = UnixControlServer(self.path,ControlHandler)
            self.server.dispatch = dispatch
            self.server.log = log
            os.chmod(self.path,0o600)
            self.thread = threading.Thread(target=self.server.serve_forever,kwargs={"poll_interval":0.1},daemon=True)
            self.thread.start()

        def close(self):
            self.server.shutdown()
            self.server.server_close()
            self.thread.join()


def control_call(state, message):
    if os.name == "nt":
        return pipe_control_call(state,message)
    connection = http.client.HTTPConnection("localhost",timeout=20)
    sock = socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
    connection.sock = sock
    try:
        sock.settimeout(20)
        sock.connect(state["control"])
        if hasattr(socket,"SO_PEERCRED"):
            pid,uid,_ = struct.unpack("3i",sock.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,struct.calcsize("3i")))
            if pid != state["pid"] or uid != os.getuid():
                raise CommandError("NO_CONTROL","Control endpoint ownership changed")
        connection.request("POST","/",body=encode(message),headers={"Content-Type":"application/json"})
        return json.loads(connection.getresponse().read(MAX_BODY + 1).decode("utf8"))
    finally:
        connection.close()
