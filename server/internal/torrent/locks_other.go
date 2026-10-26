//go:build !windows

package torrent

func lockedBy(string) []string { return nil }
