#!/usr/bin/env bash
# Bootstrap diagnostics only. exec preserves PID, signals and the ready protocol;
# the selected runtime owns its subsequent request/exit logs.
ngb_log_dir="${NGB_LOG_DIR:-${XDG_STATE_HOME:-${HOME:-/tmp}/.local/state}/netlist_graph_builder/logs}"
ngb_log_stamp="$(date +%s)"
ngb_log_prefix="${ngb_log_dir}/bash-${ngb_log_stamp}-$$"
ngb_log_enabled=1
if ngb_log_failure="$( (umask 077; mkdir -p -- "$ngb_log_dir" && : >> "${ngb_log_prefix}.run.jsonl" && : >> "${ngb_log_prefix}.error.jsonl") 2>&1 )"; then
  ngb_log_failure_code=0
else
  ngb_log_failure_code=$?
  ngb_log_enabled=0
fi

NgbJsonString() {
  local value="${1:0:4096}" LC_ALL=C
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  while [[ "$value" =~ [[:cntrl:]] ]]; do value="${value//"${BASH_REMATCH[0]}"/?}"; done
  printf '%s' "$value"
}

NgbLog() {
  local level="$1" event="$2" message="$3" code="${4:-BOOTSTRAP_FAILED}" timestamp line details failure failure_code
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  details='"operation":"bootstrap"'
  if [[ "$level" == error ]]; then
    details+=',"code":"'"$code"'","error":{"name":"BootstrapError","message":"'"$message"'"}'
    if [[ "$event" == log.write_failed ]]; then
      details='"operation":"bootstrap","code":"LOG_WRITE_FAILED","directory":"'"$(NgbJsonString "$ngb_log_dir")"'","error":{"name":"ShellError","message":"'"$(NgbJsonString "${5:-}")"'","exitCode":'"${6:-1}"'}'
    fi
  fi
  # Callers supply fixed diagnostics, never command arguments or source content.
  printf -v line '{"time":"%s","level":"%s","runtime":"bash","pid":%s,"event":"%s","message":"%s","details":{%s}}' "$timestamp" "$level" "$$" "$event" "$message" "$details"
  if [[ -t 2 && "$ngb_log_enabled" == 1 ]]; then
    printf '%s  %s\n' "$level" "$message" >&2 || true
  else
    printf '%s\n' "$line" >&2 || true
  fi
  if [[ "$ngb_log_enabled" == 1 ]]; then
    if failure="$( (umask 077; printf '%s\n' "$line" >> "${ngb_log_prefix}.run.jsonl" || exit 1; if [[ "$level" == error ]]; then printf '%s\n' "$line" >> "${ngb_log_prefix}.error.jsonl" || exit 1; fi) 2>&1 )"; then
      :
    else
      failure_code=$?
      ngb_log_enabled=0
      NgbLog error log.write_failed 'File logging unavailable; continuing on stderr' LOG_WRITE_FAILED "$failure" "$failure_code"
    fi
  fi
}
if [[ "$ngb_log_enabled" == 0 ]]; then NgbLog error log.write_failed 'File logging unavailable; continuing on stderr' LOG_WRITE_FAILED "$ngb_log_failure" "$ngb_log_failure_code"; fi
