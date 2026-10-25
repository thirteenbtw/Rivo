package probe

import "testing"

func TestTrackTitle(t *testing.T) {
	cases := []struct {
		tags map[string]string
		want string
	}{
		{map[string]string{"title": "Дубляж", "handler_name": "SoundHandler"}, "Дубляж"},
		{map[string]string{"handler_name": "MVO, HDRezka"}, "MVO, HDRezka"},
		{map[string]string{}, ""},
	}
	for _, h := range []string{"SoundHandler", "VideoHandler", "Core Media Audio", "GPAC ISO Audio Handler", "ISO Media file produced by Google Inc.", "L-SMASH Audio Handler", "Stereo"} {
		cases = append(cases, struct {
			tags map[string]string
			want string
		}{map[string]string{"handler_name": h}, ""})
	}
	for _, c := range cases {
		if got := trackTitle(c.tags); got != c.want {
			t.Errorf("%v: got %q, want %q", c.tags, got, c.want)
		}
	}
}
