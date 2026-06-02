//go:build !js || !wasm

package adapter

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

func registerProofCopyRoute(app core.App, rg *router.RouterGroup[*core.RequestEvent]) {}
