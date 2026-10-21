lassign $argv binary helper
source $helper
set root [file join [pwd] "ngb_tcl_[pid] 空格"]
file mkdir $root
set state [file join $root session.json]
set netlist [file join $root {net list.v}]
set output [open $netlist w]
puts $output {module top(input a, output z); assign z=a; endmodule}
close $output
set code [catch {
    set url [::ngb::Start $binary $state --netlist $netlist --module top --fanin-depth 0]
    if {![string match {http://127.0.0.1:*/?startup=1} $url]} {error "bad ready URL: $url"}
    if {![string match {*status=running*} [::ngb::Status $binary $state]]} {error "not running"}
    if {![catch {::ngb::Start $binary $state}]} {error "duplicate session accepted"}
    ::ngb::Stop $binary $state
    if {[file exists $state]} {error "state retained after stop"}
    if {![catch {::ngb::Start $binary $state --netlist [file join $root absent.v]}]} {error "unreadable input accepted"}
    if {![catch {::ngb::Start $binary $state --module {|}}]} {error "pipeline injection accepted"}
} message]
catch {::ngb::Stop $binary $state}
# Exact test-created directory, never a user-supplied target.
file delete -force $root
if {$code} {puts stderr $message; exit 1}
puts "Tcl ready/status/stop, Unicode paths and failure propagation passed"
