"""Fresh, reproducible RTL-to-Liberty mappings; run on the Linux test host.

python3 tools/synthesize_liberty_cases.py --yosys /path/yosys --rtl-root /path/yellow \
    --library nangate45=/path/nangate45.lib --library ihp=/path/ihp.lib --output dc_runs/run
Never overwrites an earlier run. Logs and generated files stay in the output directory.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def quoted(path):
    return json.dumps(str(path.resolve()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yosys", required=True, type=Path)
    parser.add_argument("--rtl-root", required=True, type=Path)
    parser.add_argument("--library", action="append", required=True, metavar="NAME=PATH")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cases", nargs="*")
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()
    if not 1 <= args.jobs <= 4 or args.timeout <= 0:
        parser.error("jobs must be 1..4 and timeout must be positive")
    libraries = []
    for value in args.library:
        name, path = value.split("=", 1)
        if not name.replace("_", "").isalnum():
            parser.error("Library name must contain only letters, digits and underscores")
        path = Path(path).resolve()
        libraries.append(dict(name=name, path=str(path), sha256=sha(path)))
    if len({item["name"] for item in libraries}) != len(libraries):
        parser.error("Duplicate library name")
    inputs = sorted(args.rtl_root.resolve().rglob("top.v"))
    if args.cases:
        inputs = [path for path in inputs if path.parent.name in args.cases]
        if {path.parent.name for path in inputs} != set(args.cases):
            parser.error("Requested RTL case was not found")
    if not inputs or len({path.parent.name for path in inputs}) != len(inputs):
        parser.error("Empty or ambiguous RTL case names")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    environment = dict(os.environ, PATH=str(args.yosys.resolve().parent) + os.pathsep + os.environ.get("PATH", ""))
    version = subprocess.check_output([str(args.yosys), "-V"], text=True, env=environment).strip()
    manifest = dict(version=1, yosys=version, yosysSha256=sha(args.yosys), libraries=libraries,
                    jobs=args.jobs, timeoutSeconds=args.timeout, top="tc", cases=[],
                    expectedCases=len(inputs) * len(libraries), complete=False)

    def run(library, source):
        directory = output / library["name"] / source.parent.name
        directory.mkdir(parents=True)
        netlist = directory / (source.parent.name + "_mapped.v")
        design = directory / "mapped.json"
        liberty = Path(library["path"])
        commands = [
            f"read_verilog -sv {quoted(source)}", "hierarchy -check -top tc", "synth -top tc",
            f"dfflibmap -liberty {quoted(liberty)}", f"abc -liberty {quoted(liberty)}",
            f"read_liberty -lib -ignore_miss_func {quoted(liberty)}", "clean -purge", "check -assert",
            f"stat -liberty {quoted(liberty)}", f"write_verilog -norename -noattr -noexpr -nodec {quoted(netlist)}",
            f"write_json {quoted(design)}"
        ]
        script = directory / "synthesis.ys"
        script.write_text("\n".join(commands) + "\n")
        started = time.monotonic()
        status, code = "failed", None
        with (directory / "stdout.log").open("w") as log:
            try:
                result = subprocess.run([str(args.yosys), "-Q", "-T", "-l", str(directory / "yosys.log"),
                                         "-s", str(script)], cwd=directory, env=environment, stdout=log,
                                        stderr=subprocess.STDOUT, timeout=args.timeout, check=False)
                code = result.returncode
                if code == 0 and netlist.is_file() and design.is_file():
                    status = "passed"
            except subprocess.TimeoutExpired:
                status = "timeout"
        return dict(name=source.parent.name, category=source.parent.parent.name, library=library["name"],
                    source=str(source), sourceSha256=sha(source), netlist=str(netlist), design=str(design),
                    netlistSha256=sha(netlist) if netlist.exists() else None,
                    designSha256=sha(design) if design.exists() else None,
                    elapsedSeconds=round(time.monotonic() - started, 3), status=status, exitCode=code)

    with ThreadPoolExecutor(max_workers=args.jobs) as executor:
        tasks = [executor.submit(run, library, source) for library in libraries for source in inputs]
        for task in as_completed(tasks):
            result = task.result()
            manifest["cases"].append(result)
            print(json.dumps({key: result[key] for key in ["library", "name", "status", "elapsedSeconds"]}), flush=True)
            (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    manifest["cases"].sort(key=lambda item: (item["library"], item["name"]))
    manifest["complete"] = True
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    failed = sum(item["status"] != "passed" for item in manifest["cases"])
    print(json.dumps(dict(cases=len(manifest["cases"]), failed=failed, manifest=str(output / "manifest.json"))))
    raise SystemExit(bool(failed))


if __name__ == "__main__":
    main()
