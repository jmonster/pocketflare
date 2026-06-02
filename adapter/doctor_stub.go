//go:build !js || !wasm

package adapter

func checkR2Binding(bindingName string) r2BindingCheck {
	return r2BindingCheck{OK: false, Error: "not available outside WASM"}
}
