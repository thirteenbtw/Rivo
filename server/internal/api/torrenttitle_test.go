package api

import "testing"

func TestTitleForTorrent(t *testing.T) {
	cases := []struct{ known, release, file, want string }{
		{"Духless", "Duhless.2011.BDRemux.1080p", "BDMV/STREAM/00002.m2ts", "Духless"},
		{"", "Duhless.2011.BDRemux.1080p", "BDMV/STREAM/00002.m2ts", "Duhless"},
		{"", "Духless (2011) BDRip 1080p", "Духless (2011) BDRip 1080p.mkv", "Духless"},
		{"Тед Лассо", "Ted.Lasso.S01.1080p", "Ted.Lasso.S01E03.1080p.mkv", "Тед Лассо · S1E3"},
		{"", "Ted.Lasso.S01.1080p", "Ted.Lasso.S01E03.1080p.mkv", "Ted Lasso · S1E3"},
		{"", "", "00002.m2ts", "00002.m2ts"},
	}
	for _, c := range cases {
		if got := titleForTorrent(c.known, c.release, c.file); got != c.want {
			t.Errorf("titleForTorrent(%q, %q, %q) = %q, want %q", c.known, c.release, c.file, got, c.want)
		}
	}
}
