"""Merge completed synthesis retries without hiding earlier failures or changing input identities.

Usage: python tools/merge_liberty_synthesis_runs.py new-manifest.json first.json retry.json ...
"""
import hashlib
import json
from pathlib import Path
import sys


destination = Path(sys.argv[1])
if destination.exists():
    raise ValueError("Output already exists")
paths = [Path(path).resolve() for path in sys.argv[2:]]
if not paths:
    raise ValueError("At least one manifest is required")
merged, identities, cases, sources = None, None, {}, []
for path in paths:
    text = path.read_bytes()
    run = json.loads(text)
    if run.get("complete") is not True or len(run["cases"]) != run["expectedCases"]:
        raise ValueError(f"Incomplete run: {path}")
    identity = (run["yosys"], run["yosysSha256"])
    libraries = {item["name"]: item["sha256"] for item in run["libraries"]}
    if merged is None:
        merged = dict(run)
        identities = libraries
        expected = {(entry["library"], entry["name"]): entry["sourceSha256"] for entry in run["cases"]}
        if len(expected) != run["expectedCases"]:
            raise ValueError("Duplicate original cases")
    elif identity != (merged["yosys"], merged["yosysSha256"]) or any(identities.get(name) != digest for name, digest in libraries.items()):
        raise ValueError(f"Tool or library identity changed: {path}")
    sources.append(dict(path=str(path), sha256=hashlib.sha256(text).hexdigest(),
                        jobs=run["jobs"], timeoutSeconds=run["timeoutSeconds"]))
    seen = set()
    for entry in run["cases"]:
        key = (entry["library"], entry["name"])
        if key in seen or expected.get(key) != entry["sourceSha256"] or key[0] not in libraries:
            raise ValueError(f"Duplicate, extra or changed RTL: {key}")
        seen.add(key)
        previous = cases.get(key)
        attempts = previous["attempts"][:] if previous else []
        attempts.append(dict(manifest=str(path), status=entry["status"], elapsedSeconds=entry["elapsedSeconds"],
                             netlist=entry["netlist"], design=entry["design"]))
        # A failed retry never replaces an already valid artifact.
        selected = entry if previous is None or entry["status"] == "passed" else previous
        cases[key] = dict(selected, attempts=attempts)
merged["cases"] = [cases[key] for key in sorted(cases)]
merged["sourceRuns"] = sources
merged["jobs"] = None
merged["timeoutSeconds"] = None  # Per-attempt limits are retained in sourceRuns.
with destination.open("x") as stream:
    json.dump(merged, stream, indent=2)
    stream.write("\n")
print(json.dumps(dict(cases=len(cases), failed=sum(entry["status"] != "passed" for entry in cases.values()), output=str(destination))))
