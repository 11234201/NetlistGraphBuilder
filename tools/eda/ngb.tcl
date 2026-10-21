# Tcl 8.5+, no Tcllib or shell. Keep this namespace alive until Stop is called.
namespace eval ::ngb {
    variable channels [dict create]
    variable serial 0
    variable pending
}

proc ::ngb::ReadReady {channel ticket} {
    variable pending
    if {[gets $channel line] >= 0} {
        if {[regexp {"event":"ready"} $line] &&
            [regexp {"url":"(http://127\.0\.0\.1:[0-9]+/[^" ]*)"} $line -> url]} {
            set pending($ticket) [list ready $url]
        }
    } elseif {[eof $channel]} {
        set pending($ticket) [list error "ngb exited before ready; see launcher stderr"]
    }
}

proc ::ngb::Start {binary stateFile args} {
    variable channels
    variable serial
    variable pending
    set binary [file normalize $binary]
    set stateFile [file normalize $stateFile]
    if {![file executable $binary]} { error "ngb is not executable: $binary" }
    if {[dict exists $channels $stateFile]} { error "Session already managed: $stateFile" }
    if {[file exists $stateFile]} { error "State file already exists; inspect or stop it explicitly: $stateFile" }
    set command [list $binary start --state-file $stateFile --port 0 --no-open --parent-death]
    if {[llength $args] % 2} { error "Start expects option/value pairs" }
    foreach {option value} $args {
        if {$option ni {--netlist --timing --cell-config --module --focus --fanin-depth --fanout-depth}} {
            error "Unsupported ngb option: $option"
        }
        if {$option in {--netlist --timing --cell-config}} { set value [file normalize $value] }
        # Tcl exec/open interprets these tokens as pipeline redirections even
        # inside a correctly constructed list. Never pass them as user values.
        if {[regexp {^[<>|&]} $value]} { error "Unsafe Tcl pipeline argument" }
        lappend command $option $value
    }
    file mkdir [file dirname $stateFile]
    set channel [open [concat [list |] $command [list 2>@ stderr]] r]
    set pipelinePids [pid $channel]
    fconfigure $channel -blocking 0 -buffering line -encoding utf-8
    set ticket [incr serial]
    set pending($ticket) {}
    fileevent $channel readable [list ::ngb::ReadReady $channel $ticket]
    set timer [after 10000 [list set ::ngb::pending($ticket) [list error "Timed out waiting for ngb ready"]]]
    vwait ::ngb::pending($ticket)
    after cancel $timer
    fileevent $channel readable {}
    lassign $pending($ticket) status message
    unset pending($ticket)
    if {$status ne "ready"} {
        # Stop only through the launcher's verified state protocol, never kill
        # a PID returned by Tcl's pipeline implementation.
        if {![catch {exec $binary status --state-file $stateFile} state] &&
            [regexp {"pid":([0-9]+)} $state -> ownerPid] &&
            [lsearch -exact $pipelinePids $ownerPid] >= 0} {
            catch {exec $binary stop --state-file $stateFile}
        }
        catch {close $channel}
        error $message
    }
    dict set channels $stateFile $channel
    return $message
}

proc ::ngb::Status {binary stateFile} {
    return [exec [file normalize $binary] status --state-file [file normalize $stateFile]]
}

proc ::ngb::Stop {binary stateFile} {
    variable channels
    set stateFile [file normalize $stateFile]
    # Errors are intentionally propagated. EDA must not report success when
    # ownership verification or shutdown fails.
    exec [file normalize $binary] stop --state-file $stateFile
    if {[dict exists $channels $stateFile]} {
        set channel [dict get $channels $stateFile]
        dict unset channels $stateFile
        catch {close $channel}
    }
}
