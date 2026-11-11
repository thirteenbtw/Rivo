package transcode

import (
	"slices"
	"strings"
	"testing"

	"github.com/thirteenbtw/homecinema/server/internal/store"
)

// Picture subtitles are overlaid from the input itself; the subtitles filter
// only takes text and would read the whole (torrent) input up front.
func TestBurnBitmapSubUsesOverlay(t *testing.T) {
	m := &Manager{HWSetting: func() string { return "cpu" }}
	o := Options{Input: "http://x/stream", Quality: "720p", Height: 1080, Audio: -1,
		BurnSub: &store.Track{Index: 5, Codec: "hdmv_pgs_subtitle"}, BurnSubPos: 2}
	args := m.buildArgs(o, t.TempDir())
	i := slices.Index(args, "-filter_complex")
	if i < 0 {
		t.Fatalf("no -filter_complex: %q", args)
	}
	if g := args[i+1]; !strings.HasPrefix(g, "[0:v:0][0:s:2]overlay") || !strings.Contains(g, "scale=-2:720") || !strings.HasSuffix(g, "[v]") {
		t.Fatalf("graph %q", g)
	}
	if slices.Contains(args, "-vf") || slices.Contains(args, "0:v:0") || !slices.Contains(args, "[v]") {
		t.Fatalf("maps: %q", args)
	}

	o.BurnSub = &store.Track{Index: 3, Codec: "subrip"}
	args = m.buildArgs(o, t.TempDir())
	if slices.Contains(args, "-filter_complex") || !slices.Contains(args, "0:v:0") {
		t.Fatalf("text subtitle: %q", args)
	}
}

// Audio gaps are filled, but the sound is never stretched audibly: a large
// async budget slowed it down to a lower, rasping voice after seeks.
func TestAudioResampleDoesNotStretch(t *testing.T) {
	m := &Manager{HWSetting: func() string { return "cpu" }}
	args := m.buildArgs(Options{Input: "x.m2ts", Start: 600, Audio: -1}, t.TempDir())
	i := slices.Index(args, "-af")
	if i < 0 || args[i+1] != "aresample=async=1" {
		t.Fatalf("audio filter: %q", args)
	}
}
