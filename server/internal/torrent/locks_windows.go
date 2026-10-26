package torrent

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	rstrtmgr            = windows.NewLazySystemDLL("rstrtmgr.dll")
	rmStartSession      = rstrtmgr.NewProc("RmStartSession")
	rmRegisterResources = rstrtmgr.NewProc("RmRegisterResources")
	rmGetList           = rstrtmgr.NewProc("RmGetList")
	rmEndSession        = rstrtmgr.NewProc("RmEndSession")
)

// rmProcessInfo is RM_PROCESS_INFO.
type rmProcessInfo struct {
	PID         uint32
	StartTime   windows.Filetime
	AppName     [256]uint16
	ServiceName [64]uint16
	AppType     uint32
	AppStatus   uint32
	TSSessionID uint32
	Restartable int32
}

// lockedBy names the programs that hold path open, via the Restart Manager
// (the same API Explorer uses for «файл открыт в другой программе»).
func lockedBy(path string) []string {
	if rstrtmgr.Load() != nil {
		return nil
	}
	var session uint32
	var key [33]uint16
	if r, _, _ := rmStartSession.Call(uintptr(unsafe.Pointer(&session)), 0, uintptr(unsafe.Pointer(&key[0]))); r != 0 {
		return nil
	}
	defer rmEndSession.Call(uintptr(session))
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil
	}
	if r, _, _ := rmRegisterResources.Call(uintptr(session), 1, uintptr(unsafe.Pointer(&p)), 0, 0, 0, 0); r != 0 {
		return nil
	}
	var procs [16]rmProcessInfo
	var needed, reasons uint32
	n := uint32(len(procs))
	if r, _, _ := rmGetList.Call(uintptr(session), uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&n)), uintptr(unsafe.Pointer(&procs[0])), uintptr(unsafe.Pointer(&reasons))); r != 0 {
		return nil
	}
	var out []string
	for _, pi := range procs[:n] {
		name := windows.UTF16ToString(pi.AppName[:])
		if int(pi.PID) == os.Getpid() {
			name = "Rivo"
		}
		out = append(out, name)
	}
	return out
}
