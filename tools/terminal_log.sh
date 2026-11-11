#!/usr/bin/env bash
# Bootstrap diagnostics only. exec preserves PID, signals and the ready protocol;
# the selected runtime owns its subsequent request/exit logs.
ngb_log_dir="${NGB_LOG_DIR:-${XDG_STATE_HOME:-${HOME:-/tmp}/.local/state}/netlist_graph_builder/logs}"
printf -v ngb_log_stamp '%(%s)T' -1
ngb_log_prefix="${ngb_log_dir}/bash-${ngb_log_stamp}-$$"
ngb_log_enabled=1
if ! (umask 077; mkdir -p -- "$ngb_log_dir" && : >> "${ngb_log_prefix}.run.jsonl" && : >> "${ngb_log_prefix}.error.jsonl") 2>/dev/null; then
  ngb_log_enabled=0
fi

NgbLog() {
  local level="$1" event="$2" message="$3" timestamp line
  printf -v timestamp '%(%Y-%m-%dT%H:%M:%S%z)T' -1
  # Callers supply fixed diagnostics, never command arguments or source content.
  printf -v line '{"time":"%s","level":"%s","runtime":"bash","pid":%s,"event":"%s","message":"%s"}' "$timestamp" "$level" "$$" "$event" "$message"
  printf '%s\n' "$line" >&2 || true
  if [[ "$ngb_log_enabled" == 1 ]]; then
    if ! (umask 077; printf '%s\n' "$line" >> "${ngb_log_prefix}.run.jsonl" || exit 1; if [[ "$level" == error ]]; then printf '%s\n' "$line" >> "${ngb_log_prefix}.error.jsonl" || exit 1; fi) 2>/dev/null; then
      ngb_log_enabled=0
      NgbLog error log.write_failed 'File logging unavailable; continuing on stderr'
    fi
  fi
}
if [[ "$ngb_log_enabled" == 0 ]]; then NgbLog error log.write_failed 'File logging unavailable; continuing on stderr'; fi
