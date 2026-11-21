lassign $argv adapter launcher state page report
if {[info exists ::env(NGB_TEST_TCL_BRIDGE)]} {
    source $::env(NGB_TEST_TCL_BRIDGE)
} else {
    source [file join [file dirname [info script]] ../../tools/eda/ngb.tcl]
}
switch -- $adapter {
    node {set command [list node $launcher]}
    python {set command [list /usr/bin/python3 $launcher]}
    default {set command [list $launcher]}
}
set info [::ngb::Connect $command $state]
if {[dict get $info version] != 1} {error "Wrong protocol version"}
# A failed reconnect must leave this interpreter's existing connection usable.
if {![catch {::ngb::Connect [list [file join [file dirname $state] missing-launcher]] $state}]} {
    error "Missing launcher unexpectedly connected"
}
set reply [::ngb::Cmd $state --page $page timing add $report]
if {[dict get $reply status] ne "committed" || [dict get $reply page] ne $page} {error "Timing import did not commit to target"}
if {[dict get [lindex [dict get $reply result files] 0] name] ne [file tail $report]} {
    error "The Tcl reply did not preserve the timing filename"
}
if {![catch {::ngb::Cmd $state --page $page timing add "$report.missing"} msg opts]} {error "Missing file unexpectedly succeeded"}
if {[dict get $opts -errorcode] ne {NGB ENOENT}} {error "Unexpected error code [dict get $opts -errorcode]"}
set receipt [dict get $opts -ngbreceipt]
if {[dict get $receipt page] ne $page || [dict get $receipt requestId] eq ""} {error "Missing failed request identity"}
::ngb::Cmd $state --page $page module open top
set selected [::ngb::Cmd $state --page $page selection set input:a]
if {[dict get $selected result selection id] ne "input:a"} {error "Incorrect selection in Tcl receipt"}
set view [::ngb::Cmd $state --page $page viewport get]
if {[dict get $view result scale] <= 0} {error "Invalid viewport scale"}
foreach command {{liberty status} {compare status} {path draft} {analysis status} {ui status} {log list}} {
    set result [::ngb::Cmd $state --page $page {*}$command]
    if {[dict get $result status] ne "committed" || [dict get $result page] ne $page} {
        error "Wrong target or status for $command"
    }
}
puts "TCL_PASS $page"
