package torrent

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

// makeSparse creates path if needed, marks it sparse and sizes it to the
// file's full length, so writing far past what is written so far does not
// zero-fill the gap. The size matters too: the storage reads pieces through
// a file mapping, and CreateFileMapping refuses an empty file, which failed
// the hash check of every piece touching one ("The volume for a file has been
// externally altered"). Growing a sparse file costs no disk space. Where the
// volume has no sparse files (FAT, exFAT) the file is left as it was.
func makeSparse(path string, size int64) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	_, statErr := os.Stat(path)
	created := os.IsNotExist(statErr)
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return err
	}
	var n uint32
	err = windows.DeviceIoControl(windows.Handle(f.Fd()), windows.FSCTL_SET_SPARSE, nil, 0, nil, 0, &n, nil)
	if err == nil {
		if st, serr := f.Stat(); serr == nil && st.Size() < size {
			err = f.Truncate(size)
		}
	}
	f.Close()
	if err != nil && created {
		os.Remove(path)
	}
	return err
}
