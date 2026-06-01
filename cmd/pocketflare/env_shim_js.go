//go:build js && wasm

package main

import (
	"os"
	"syscall/js"
)

// init copies all Worker environment variables (secrets, [vars], bindings)
// into Go's os.Environ so that os.Getenv works transparently in the WASM
// runtime. Without this shim, os.Getenv returns empty for every Worker env
// var because Go/WASM has no native OS environment.
func init() {
	env := js.Global().Get("context").Get("env")
	if env.IsUndefined() || env.IsNull() {
		return
	}
	keys := js.Global().Get("Object").Call("keys", env)
	n := keys.Length()
	for i := 0; i < n; i++ {
		key := keys.Index(i).String()
		val := env.Get(key)
		if val.Type() == js.TypeString {
			os.Setenv(key, val.String())
		}
	}
}
