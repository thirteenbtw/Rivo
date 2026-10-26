package torrent

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

// makeSparse creates path if needed and marks it sparse, so writing far past
// its end does not zero-fill the gap. Marking an existing file only affects
// later growth, which is what matters for a half-downloaded .part file.
func makeSparse(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	var n uint32
	return windows.DeviceIoControl(windows.Handle(f.Fd()), windows.FSCTL_SET_SPARSE, nil, 0, nil, 0, &n, nil)
}
