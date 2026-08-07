# Mapped netlist fixtures

These 47 gate-level Verilog fixtures are generated from the Local Resyn yellow
cases with Yosys 0.53 and the Nangate Open Cell Library. Only the mapped
Verilog is checked in; synthesis logs, JSON output, and benchmark reports stay
under the ignored `dc_runs/` directory.

Run the normal transformed-layout regression with:

```text
npm run test:mapped-cases
```

Run the full-node regression without large-group collapse with:

```text
MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases
```

On PowerShell, set the environment variable before invoking npm:

```powershell
$env:MAPPED_CASE_NO_COLLAPSE = "1"
npm run test:mapped-cases
```
