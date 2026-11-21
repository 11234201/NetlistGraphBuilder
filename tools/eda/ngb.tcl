# Tcl 8.5+, no Tcllib or shell. Keep this namespace alive until Stop is called.
namespace eval ::ngb {
    variable channels [dict create]
    variable launchers [dict create]
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
        if {$option ni {--netlist --timing --cell-config --browse-root --module --focus --fanin-depth --fanout-depth}} {
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
        if {![catch {exec $binary status --state-file $stateFile 2>@ stderr} state] &&
            [regexp {"pid":([0-9]+)} $state -> ownerPid] &&
            [lsearch -exact $pipelinePids $ownerPid] >= 0} {
            catch {exec $binary stop --state-file $stateFile 2>@ stderr}
        }
        catch {close $channel}
        error $message
    }
    variable launchers
    dict set launchers $stateFile [list $binary]
    dict set channels $stateFile $channel
    return $message
}

proc ::ngb::Connect {launcherArgv stateFile} {
    variable launchers
    set stateFile [file normalize $stateFile]
    if {![llength $launcherArgv]} {error "Missing launcher"}
    foreach arg $launcherArgv {
        if {[regexp {^(2?>|[<|&])} $arg]} {error "Invalid launcher argument"}
    }
    set reply [RunCommand $launcherArgv $stateFile pages]
    dict set launchers $stateFile $launcherArgv
    return [dict create version [dict get $reply version] stateFile $stateFile]
}

proc ::ngb::Cmd {stateFile args} {
    variable launchers
    set stateFile [file normalize $stateFile]
    if {![dict exists $launchers $stateFile]} {return -code error -errorcode {NGB NO_CONNECTION} "Connect to this state file first"}
    return [RunCommand [dict get $launchers $stateFile] $stateFile {*}$args]
}

proc ::ngb::RunCommand {launcher stateFile args} {
    set encoded {}
    foreach arg $args {
        binary scan [encoding convertto utf-8 $arg] H* hex
        lappend encoded x$hex
    }
    set reply [exec {*}$launcher cmd --state-file $stateFile --tcl --argv-stdin << [join $encoded " "] 2>@ stderr]
    if {[dict exists $reply error]} {
        return -code error -errorcode [list NGB [dict get $reply error code]] -ngbreceipt $reply [dict get $reply error message]
    }
    return $reply
}

proc ::ngb::Status {binary stateFile} {
    # Tcl treats captured stderr as an exec error even for exit status 0.
    # Forward diagnostics separately; nonzero child exit status still propagates.
    return [exec [file normalize $binary] status --state-file [file normalize $stateFile] 2>@ stderr]
}

proc ::ngb::Stop {binary stateFile} {
    variable channels
    set stateFile [file normalize $stateFile]
    # Errors are intentionally propagated. EDA must not report success when
    # ownership verification or shutdown fails.
    exec [file normalize $binary] stop --state-file $stateFile 2>@ stderr
    variable launchers
    if {[dict exists $launchers $stateFile]} {dict unset launchers $stateFile}
    if {[dict exists $channels $stateFile]} {
        set channel [dict get $channels $stateFile]
        dict unset channels $stateFile
        catch {close $channel}
    }
}
