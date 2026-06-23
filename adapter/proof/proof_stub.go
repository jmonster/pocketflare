//go:build !js || !wasm

package proof

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// Register is a no-op on non-WASM builds.
func Register(app core.App, rg *router.RouterGroup[*core.RequestEvent]) {}
