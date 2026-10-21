"""Build-system regression test. Run on Linux; all scratch stays in the build tree."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

source = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix="ngb cmake 空格 ", dir=str(Path.cwd())) as temporary:
    root = Path(temporary)
    checkout = root / "source"
    checkout.mkdir()
    for name in ("native", "src", "vendor", "tools"):
        shutil.copytree(str(source / name), str(checkout / name))
    for name in ("index.html", "styles.css"):
        shutil.copy2(str(source / name), str(checkout / name))
    build = root / "build"

    def run(*arguments):
        result = subprocess.run(list(map(str, arguments)), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                universal_newlines=True, timeout=90)
        if result.returncode:
            raise RuntimeError(result.stdout)
        return result.stdout

    run("cmake", "-S", checkout / "native", "-B", build, "-DCMAKE_BUILD_TYPE=Release",
        "-DNGB_INSTALL_BINDIR=libexec/eda")
    run("cmake", "--build", build, "-j2")
    generated = build / "generated/embedded_assets.cpp"
    stamp = generated.stat().st_mtime_ns
    run("cmake", "--build", build, "-j2")
    assert generated.stat().st_mtime_ns == stamp, "no-op build rewrote asset bundle"
    probe = checkout / "src/maintenance_probe.js"
    probe.write_text("export const probe = true;\n")
    run("cmake", "--build", build, "-j2")
    assert '"src/maintenance_probe.js"' in generated.read_text()
    probe.unlink()
    run("cmake", "--build", build, "-j2")
    assert '"src/maintenance_probe.js"' not in generated.read_text(), "removed asset still embedded"
    with (checkout / "styles.css").open("a") as stream:
        stream.write("\n/* incremental maintenance probe */\n")
    stamp = generated.stat().st_mtime_ns
    run("cmake", "--build", build, "-j2")
    assert generated.stat().st_mtime_ns != stamp, "changed asset did not rebuild"
    prefix = root / "install"
    run("cmake", "--install", build, "--prefix", prefix)
    assert (prefix / "libexec/eda/ngb").is_file()
    assert (prefix / "share/netlist_graph_builder/ngb.tcl").is_file()
    run(prefix / "libexec/eda/ngb", "--licenses")

    # EDA parent owns installation policy; add_subdirectory must not force it.
    parent = root / "eda"
    parent.mkdir()
    (parent / "CMakeLists.txt").write_text('''cmake_minimum_required(VERSION 3.16)
project(eda_integration LANGUAGES CXX)
set(NGB_INSTALL OFF CACHE BOOL "" FORCE)
add_subdirectory("%s/native" ngb)
''' % checkout.as_posix())
    run("cmake", "-S", parent, "-B", root / "parent-build")
    run("cmake", "--build", root / "parent-build", "--target", "ngb", "-j2")
    run("cmake", "--install", root / "parent-build", "--prefix", root / "disabled-install")
    assert not (root / "disabled-install").exists()
print("CMake standalone, no-op, add/remove/change assets, install and EDA add_subdirectory passed")
