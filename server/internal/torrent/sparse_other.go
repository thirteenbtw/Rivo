//go:build !windows

package torrent

// makeSparse is a no-op: Unix file systems leave holes on their own.
func makeSparse(string, int64) error { return nil }
