"""Package the build machine's x64 CPython into an isolated, offline launcher runtime."""
import os
import platform
import shutil
import sys
import zipfile
from pathlib import Path


def main(package):
    base = Path(sys.base_prefix)
    if sys.platform != "win32" or platform.machine().lower() not in ("amd64", "x86_64") or sys.maxsize <= 2**32:
        raise RuntimeError("The release requires an x64 Windows CPython installation")
    if sys.version_info[:2] < (3, 10):
        raise RuntimeError("Packaging requires CPython 3.10 or later")
    runtime = package / "runtime"
    runtime.mkdir()
    tag = "python{}{}".format(*sys.version_info[:2])
    for src in [base / (tag + ".dll"), base / "python3.dll", *base.glob("vcruntime*.dll")]:
        shutil.copy2(src, runtime)
    dlls = base / "DLLs"
    for ext in ("_socket","select","_ctypes","_multiprocessing","_overlapped","_queue","_ssl","_hashlib",
                "_bz2","_lzma","unicodedata","pyexpat"):
        src = dlls / (ext + ".pyd")
        if src.exists():
            shutil.copy2(src, runtime)
    for pattern in ("libcrypto*.dll","libssl*.dll","libffi*.dll","zlib*.dll"):
        for src in dlls.glob(pattern):
            shutil.copy2(src, runtime)
    lib = base / "Lib"
    excluded = {"site-packages","test","tests","__pycache__","idlelib","tkinter","turtledemo","ensurepip","venv"}
    with zipfile.ZipFile(runtime / "stdlib.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for directory, children, files in os.walk(lib):
            children[:] = sorted(child for child in children if child not in excluded)
            for name in sorted(files):
                if name.endswith(".py"):
                    src = Path(directory) / name
                    archive.write(src, src.relative_to(lib).as_posix())
    (runtime / (tag + "._pth")).write_text("stdlib.zip\n.\n../app/tools\n",encoding="ascii")
    (runtime / "version.txt").write_text(tag + ".dll\n", encoding="ascii")
    shutil.copy2(base / "LICENSE.txt",package / "PYTHON-LICENSE.txt")
    notices = base / "Doc" / "html" / "license.html"
    if notices.exists():
        shutil.copy2(notices,package / "PYTHON-THIRD-PARTY-NOTICES.html")
    (runtime / "BUILD.txt").write_text("CPython " + sys.version + "\n",encoding="utf8")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
