package probe

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// androidLinker runs an executable from app storage. Since Android 10 SELinux
// denies execve() of files under /data/data for apps targeting newer SDKs, so
// Termux itself launches its programs through the system linker; a Go binary
// has no termux-exec preload and must do the same, or ffmpeg fails with
// "fork/exec …: permission denied".
const androidLinker = "/system/bin/linker64"

// Command is exec.CommandContext that also works for ffmpeg/ffprobe
// installed in Termux on Android. Binaries an APK ships in its native
// library dir (/data/app/...) may be executed directly.
func Command(ctx context.Context, name string, args ...string) *exec.Cmd {
	if runtime.GOOS == "android" {
		if p, err := exec.LookPath(name); err == nil && strings.HasPrefix(p, "/data/") && !strings.HasPrefix(p, "/data/app/") {
			if _, err := os.Stat(androidLinker); err == nil {
				return exec.CommandContext(ctx, androidLinker, append([]string{p}, args...)...)
			}
		}
	}
	return exec.CommandContext(ctx, name, args...)
}
