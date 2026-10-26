package api

import (
	"fmt"
	"strings"

	"github.com/thirteenbtw/homecinema/server/internal/store"
)

// Track labels for the player menu and the TV: the name the release gave a
// track ("Дубляж, Пифагор") leads, the language, format and flags follow.
// Without a name the language leads; without either, the track number.

var langNames = map[string]string{
	"rus": "Русский", "ru": "Русский", "eng": "English", "en": "English", "ukr": "Українська", "uk": "Українська",
	"bel": "Беларуская", "be": "Беларуская", "kaz": "Қазақша", "kk": "Қазақша", "uzb": "Oʻzbekcha", "uz": "Oʻzbekcha",
	"ger": "Deutsch", "deu": "Deutsch", "de": "Deutsch", "fre": "Français", "fra": "Français", "fr": "Français",
	"spa": "Español", "es": "Español", "ita": "Italiano", "it": "Italiano", "por": "Português", "pt": "Português",
	"pol": "Polski", "pl": "Polski", "cze": "Čeština", "ces": "Čeština", "cs": "Čeština", "slo": "Slovenčina", "slk": "Slovenčina",
	"bul": "Български", "bg": "Български", "srp": "Српски", "sr": "Српски", "hrv": "Hrvatski", "hr": "Hrvatski",
	"rum": "Română", "ron": "Română", "ro": "Română", "hun": "Magyar", "hu": "Magyar", "gre": "Ελληνικά", "ell": "Ελληνικά", "el": "Ελληνικά",
	"tur": "Türkçe", "tr": "Türkçe", "dut": "Nederlands", "nld": "Nederlands", "nl": "Nederlands",
	"swe": "Svenska", "sv": "Svenska", "nor": "Norsk", "nob": "Norsk", "no": "Norsk", "dan": "Dansk", "da": "Dansk", "fin": "Suomi", "fi": "Suomi",
	"est": "Eesti", "et": "Eesti", "lav": "Latviešu", "lv": "Latviešu", "lit": "Lietuvių", "lt": "Lietuvių",
	"geo": "ქართული", "kat": "ქართული", "ka": "ქართული", "arm": "Հայերեն", "hye": "Հայերեն", "hy": "Հայերեն", "aze": "Azərbaycan", "az": "Azərbaycan",
	"heb": "עברית", "he": "עברית", "ara": "العربية", "ar": "العربية", "per": "فارسی", "fas": "فارسی", "fa": "فارسی",
	"hin": "हिन्दी", "hi": "हिन्दी", "tha": "ไทย", "th": "ไทย", "vie": "Tiếng Việt", "vi": "Tiếng Việt", "ind": "Indonesia", "id": "Indonesia",
	"jpn": "日本語", "ja": "日本語", "kor": "한국어", "ko": "한국어", "chi": "中文", "zho": "中文", "zh": "中文", "cmn": "中文", "yue": "粵語",
}

func langName(code string) string {
	c := strings.ToLower(strings.TrimSpace(code))
	if i := strings.IndexAny(c, "-_"); i > 0 { // pt-BR, zh_Hans
		c = c[:i]
	}
	if n := langNames[c]; n != "" {
		return n
	}
	if c == "" || c == "und" || c == "unk" || c == "mis" || c == "zxx" || c == "mul" {
		return ""
	}
	return strings.ToUpper(c)
}

// trackLang is the language of a track: its tag, or a hint in its name when
// the tag is missing ("Rus", "Русские", "Eng SDH").
func trackLang(t store.Track) string {
	if l := langName(t.Lang); l != "" {
		return l
	}
	n := strings.ToLower(t.Title)
	switch {
	case strings.Contains(n, "рус") || hasWord(n, "rus") || hasWord(n, "ru") || strings.Contains(n, "russian"):
		return "Русский"
	case strings.Contains(n, "укр") || hasWord(n, "ukr") || hasWord(n, "ua") || strings.Contains(n, "ukrainian"):
		return "Українська"
	case strings.Contains(n, "англ") || hasWord(n, "eng") || hasWord(n, "en") || strings.Contains(n, "english"):
		return "English"
	}
	return ""
}

func hasWord(s, w string) bool {
	for _, f := range strings.FieldsFunc(s, func(r rune) bool { return !(r >= 'a' && r <= 'z' || r >= 'а' && r <= 'я' || r == 'ё') }) {
		if f == w {
			return true
		}
	}
	return false
}

// trackName is what the track is called. A name that only repeats the
// language ("Rus", "English") gives way to the language itself.
func trackName(t store.Track, i int, kind string) (name, lang string) {
	lang = trackLang(t)
	title := strings.TrimSpace(t.Title)
	if title != "" {
		if strings.EqualFold(title, lang) || langName(title) == lang {
			title = ""
		}
	}
	if r := plainNames[strings.ToLower(title)]; r != "" {
		title = r
	}
	switch {
	case title != "":
		return title, lang
	case lang != "":
		return lang, ""
	}
	return fmt.Sprintf("%s %d", kind, i+1), ""
}

// plainNames translates the stock English names releases give tracks.
var plainNames = map[string]string{
	"forced": "Только надписи", "signs": "Надписи", "signs & songs": "Надписи и песни", "signs/songs": "Надписи и песни",
	"full": "Полные", "sdh": "Для глухих", "cc": "Для глухих", "commentary": "Комментарии", "director's commentary": "Комментарии режиссёра",
}

func audioLabel(t store.Track, i int) (name, meta string) {
	name, lang := trackName(t, i, "Дорожка")
	parts := []string{}
	if lang != "" && !strings.Contains(strings.ToLower(name), strings.ToLower(lang)) {
		parts = append(parts, lang)
	}
	parts = append(parts, audioFormat(t))
	if t.Comment && !strings.Contains(strings.ToLower(name), "коммент") && !strings.Contains(strings.ToLower(name), "comment") {
		parts = append(parts, "комментарии")
	}
	if t.Described {
		parts = append(parts, "тифлокомментарий")
	}
	return name, strings.Join(parts, " · ")
}

func audioFormat(t store.Track) string {
	ch := ""
	switch t.Channels {
	case 0:
	case 1:
		ch = " 1.0"
	case 2:
		ch = " 2.0"
	case 3:
		ch = " 2.1"
	case 6:
		ch = " 5.1"
	case 7:
		ch = " 6.1"
	case 8:
		ch = " 7.1"
	default:
		ch = fmt.Sprintf(" %d кан.", t.Channels)
	}
	if p := profileName(t); p != "" {
		return p + ch
	}
	c := map[string]string{"eac3": "DD+", "ac3": "DD", "dts": "DTS", "truehd": "TrueHD", "aac": "AAC", "mp3": "MP3", "opus": "Opus", "flac": "FLAC", "vorbis": "Vorbis", "mp2": "MP2", "pcm_s16le": "PCM", "pcm_s24le": "PCM"}[t.Codec]
	if c == "" {
		c = strings.ToUpper(t.Codec)
	}
	return c + ch
}

func subLabel(t store.Track, i int) (name, meta string) {
	name, lang := trackName(t, i, "Субтитры")
	low := strings.ToLower(name)
	parts := []string{}
	if lang != "" && !strings.Contains(low, strings.ToLower(lang)) {
		parts = append(parts, lang)
	}
	if t.Forced && !strings.Contains(low, "forced") && !strings.Contains(low, "форс") && !strings.Contains(low, "надписи") {
		parts = append(parts, "только надписи")
	}
	if t.SDH && !strings.Contains(low, "sdh") && !strings.Contains(low, "глух") {
		parts = append(parts, "для глухих")
	}
	codec := map[string]string{"subrip": "SRT", "srt": "SRT", "ass": "ASS", "ssa": "SSA", "mov_text": "TX3G", "webvtt": "VTT", "vtt": "VTT",
		"hdmv_pgs_subtitle": "PGS", "sup": "PGS", "dvd_subtitle": "VobSub", "dvb_subtitle": "DVB"}[strings.ToLower(t.Codec)]
	if codec == "" {
		codec = strings.ToUpper(strings.TrimSuffix(t.Codec, "_subtitle"))
	}
	parts = append(parts, codec)
	if t.External != "" {
		parts = append(parts, "внешние")
	} else {
		parts = append(parts, "встроенные")
	}
	return name, strings.Join(parts, " · ")
}

// profileName names the variant a profile tells apart from the plain codec:
// DTS-HD MA rather than DTS, Atmos on top of TrueHD or DD+.
func profileName(t store.Track) string {
	p := strings.ToLower(t.Profile)
	switch {
	case t.Codec == "dts" && strings.Contains(p, "dts:x"):
		return "DTS:X"
	case t.Codec == "dts" && strings.Contains(p, "dts-hd ma"):
		return "DTS-HD MA"
	case t.Codec == "dts" && strings.Contains(p, "dts-hd hra"):
		return "DTS-HD HRA"
	case t.Codec == "dts" && strings.Contains(p, "dts-es"):
		return "DTS-ES"
	case t.Codec == "truehd" && strings.Contains(p, "atmos"):
		return "TrueHD Atmos"
	case t.Codec == "eac3" && strings.Contains(p, "atmos"):
		return "DD+ Atmos"
	}
	return ""
}

// nameDuplicates numbers tracks that would read the same. Blu-ray (m2ts)
// carries no track names, so a remux with four Russian dubs would show four
// identical "Русский" rows. Same-looking audio also gets its bitrate, the one
// thing that still tells, say, a dub from a voice-over in such a file.
func nameDuplicates(ts []trackOut, audio bool) {
	if audio {
		same := map[string]int{}
		for _, t := range ts {
			same[t.Name+"|"+t.Meta]++
		}
		for i := range ts {
			if t := &ts[i]; same[t.Name+"|"+t.Meta] > 1 && t.kbps > 0 {
				t.Meta += fmt.Sprintf(" · %d кбит/с", t.kbps)
			}
		}
	}
	count := map[string]int{}
	for _, t := range ts {
		count[t.Name]++
	}
	seen := map[string]int{}
	for i := range ts {
		t := &ts[i]
		if count[t.Name] > 1 {
			seen[t.Name]++
			t.Name = fmt.Sprintf("%s %d", t.Name, seen[t.Name])
		}
		t.Label = t.Name + " · " + t.Meta
	}
}
