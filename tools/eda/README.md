# EDA Tcl integration

Source ngb.tcl in Tcl 8.5+ and call `::ngb::Start binary stateFile ?option value ...?`.
It returns a localhost URL only after ready (10-second timeout), keeps its pipeline open, and defaults to parent-death, port 0 and no-open.
Use `::ngb::Status binary stateFile` and `::ngb::Stop binary stateFile`; errors propagate to EDA.
No Tcllib, shell interpolation or direct PID killing. Paths support spaces/Unicode.
Non-path arguments beginning with Tcl pipeline redirection characters are rejected.

Existing state files are refused rather than silently replaced; inspect/stop explicitly with the native CLI.
See [installation, semantics and port forwarding](../../docs/LINUX_SINGLE_FILE_LAUNCHER.md).
