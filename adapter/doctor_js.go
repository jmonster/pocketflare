//go:build js && wasm

package adapter

import (
	"context"
	"syscall/js"

	"github.com/syumai/workers/cloudflare"

	"github.com/pocketflare/pocketflare/adapter/internal/jsutil"
)

type r2BindingCheck struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func checkR2Binding(bindingName string) r2BindingCheck {
	bucket := cloudflare.GetBinding(bindingName)
	if bucket.IsUndefined() || bucket.IsNull() {
		return r2BindingCheck{OK: false, Error: "binding not found"}
	}

	opts := js.Global().Get("Object").New()
	opts.Set("limit", 1)

	promise := bucket.Call("list", opts)
	_, err := jsutil.AwaitPromise(context.Background(), promise)
	if err != nil {
		return r2BindingCheck{OK: false, Error: err.Error()}
	}

	return r2BindingCheck{OK: true}
}
