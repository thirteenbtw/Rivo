package netutil

import (
	"fmt"
	"net"

	"github.com/wlynxg/anet"
)

// InterfaceByName looks an interface up through anet, which also works on
// Android 11+, where the standard library's netlink calls are denied.
func InterfaceByName(name string) (*net.Interface, error) {
	ifs, err := anet.Interfaces()
	if err != nil {
		return nil, err
	}
	for i := range ifs {
		if ifs[i].Name == name {
			return &ifs[i], nil
		}
	}
	return nil, fmt.Errorf("интерфейс %q не найден", name)
}
