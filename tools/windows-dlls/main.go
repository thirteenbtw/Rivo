// Command windows-dlls fails when a Windows exe needs a DLL that a clean
// Windows does not have. A server built with cgo by the CI's MinGW links
// libstdc++-6.dll, libgcc_s_seh-1.dll and libwinpthread-1.dll, which exist on
// the build machine but not on the person's PC, so the server dies on start
// with STATUS_DLL_NOT_FOUND (0xC0000135).
//
//	go run tools/windows-dlls/main.go file.exe...
package main

import (
	"debug/pe"
	"fmt"
	"os"
	"strings"
)

// DLLs every supported Windows (10 and later) ships in System32.
var system = map[string]bool{}

func init() {
	for _, n := range strings.Fields(`
		kernel32 kernelbase ntdll user32 gdi32 gdiplus advapi32 shell32 shlwapi ole32 oleaut32
		ws2_32 wsock32 iphlpapi dnsapi winmm secur32 crypt32 bcrypt bcryptprimitives ncrypt
		userenv powrprof psapi dbghelp version setupapi cfgmgr32 mswsock winhttp wininet
		comctl32 comdlg32 imm32 uxtheme dwmapi d3d9 d3d11 d3d12 dxgi dxva2 mfplat mf mfuuid
		mfreadwrite evr avrt ksuser strmiids normaliz rpcrt4 msvcrt ucrtbase netapi32 mpr
		wtsapi32 credui sspicli schannel opengl32 vulkan-1 nvcuda`) {
		system[n+".dll"] = true
	}
}

func main() {
	bad := false
	for _, f := range os.Args[1:] {
		pf, err := pe.Open(f)
		if err != nil {
			fmt.Fprintln(os.Stderr, f, err)
			os.Exit(2)
		}
		libs, err := pf.ImportedLibraries()
		pf.Close()
		if err != nil {
			fmt.Fprintln(os.Stderr, f, err)
			os.Exit(2)
		}
		for _, l := range libs {
			n := strings.ToLower(l)
			if system[n] || strings.HasPrefix(n, "api-ms-win-") || strings.HasPrefix(n, "ext-ms-win-") {
				continue
			}
			fmt.Printf("%s needs %s, which Windows does not ship\n", f, l)
			bad = true
		}
	}
	if bad {
		os.Exit(1)
	}
}
