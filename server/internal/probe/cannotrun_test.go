package probe

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestCannotRun(t *testing.T) {
	dir := t.TempDir()
	noexec := filepath.Join(dir, "ffprobe")
	if err := os.WriteFile(noexec, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, bin := range []string{noexec, filepath.Join(dir, "missing"), "no-such-ffprobe-binary"} {
		_, err := (&Prober{FFprobe: bin}).ProbeURL(context.Background(), "x.mkv")
		if !CannotRun(err) {
			t.Errorf("%s: CannotRun(%v) = false", bin, err)
		}
	}
	_, err := (&Prober{FFprobe: "false"}).ProbeURL(context.Background(), "x.mkv")
	if err == nil || CannotRun(err) {
		t.Errorf("a failing ffprobe run must not count as cannot-run: %v", err)
	}
}
