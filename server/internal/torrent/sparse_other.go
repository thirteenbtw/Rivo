//go:build !windows

package torrent

import (
	"os"
	"path/filepath"
)

// makeSparse only creates the file: Unix file systems leave holes on their own.
func makeSparse(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return err
	}
	return f.Close()
}
