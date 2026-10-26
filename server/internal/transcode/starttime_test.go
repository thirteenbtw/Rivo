package transcode

import "testing"

// pesPacket builds a TS packet that starts a PES with the given PTS (90 kHz).
func pesPacket(sid byte, pts int64) []byte {
	p := make([]byte, 188)
	p[0], p[1], p[3] = 0x47, 0x40, 0x10
	pes := p[4:]
	pes[2], pes[3] = 1, sid
	pes[7], pes[8] = 0x80, 5
	pes[9] = byte(0x21 | (pts>>29)&0x0E)
	pes[10] = byte(pts >> 22)
	pes[11] = byte(1 | (pts>>14)&0xFE)
	pes[12] = byte(pts >> 7)
	pes[13] = byte(1 | (pts<<1)&0xFE)
	return p
}

func TestFirstPTS(t *testing.T) {
	var seg []byte
	seg = append(seg, pesPacket(0xE0, 290_296*90)...) // keyframe
	seg = append(seg, pesPacket(0xC0, 290_214*90)...) // audio starts before it
	seg = append(seg, pesPacket(0xE0, 290_338*90)...)
	if v, ok := firstPTS(seg); !ok || v != 290.214 {
		t.Fatalf("got %v %v", v, ok)
	}
	if _, ok := firstPTS(make([]byte, 188)); ok {
		t.Fatal("empty segment parsed")
	}
}
