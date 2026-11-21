lassign $argv adapter launcher state page report
source [file join [file dirname [info script]] ../../tools/eda/ngb.tcl]
if {$adapter eq "node"} {set command [list node $launcher]} else {set command [list $launcher]}
set info [::ngb::Connect $command $state]
if {[dict get $info version] != 1} {error "Wrong protocol version"}
# A failed reconnect must leave this interpreter's existing connection usable.
if {![catch {::ngb::Connect [list [file join [file dirname $state] missing-launcher]] $state}]} {
    error "Missing launcher unexpectedly connected"
}
set reply [::ngb::Cmd $state --page $page timing add $report]
if {[dict get $reply status] ne "committed" || [dict get $reply page] ne $page} {error "Timing import did not commit to target"}
if {![catch {::ngb::Cmd $state --page $page timing add "$report.missing"} msg opts]} {error "Missing file unexpectedly succeeded"}
if {[dict get $opts -errorcode] ne {NGB ENOENT}} {error "Unexpected error code [dict get $opts -errorcode]"}
set receipt [dict get $opts -ngbreceipt]
if {[dict get $receipt page] ne $page || [dict get $receipt requestId] eq ""} {error "Missing failed request identity"}
puts "TCL_PASS $page"
