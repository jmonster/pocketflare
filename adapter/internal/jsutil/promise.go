//go:build js && wasm

// Package jsutil provides shared JavaScript interop utilities for adapter packages.
package jsutil

import (
	"context"
	"fmt"
	"syscall/js"
)

// AwaitPromise blocks on a JavaScript Promise and returns its result or error.
// If ctx expires before the Promise settles, AwaitPromise returns ctx.Err().
// Both js.Func values are guaranteed released on return regardless of which
// callback fires (or if neither fires due to ctx expiry).
func AwaitPromise(ctx context.Context, promise js.Value) (js.Value, error) {
	// Buffered so late-settling Promises don't block the JS goroutine.
	resultCh := make(chan js.Value, 1)
	errCh := make(chan error, 1)

	then := js.FuncOf(func(_ js.Value, args []js.Value) any {
		resultCh <- args[0]
		return js.Undefined()
	})
	catch := js.FuncOf(func(_ js.Value, args []js.Value) any {
		errCh <- fmt.Errorf("promise rejected: %s", args[0].Call("toString").String())
		return js.Undefined()
	})
	defer then.Release()
	defer catch.Release()

	promise.Call("then", then).Call("catch", catch)

	select {
	case result := <-resultCh:
		return result, nil
	case err := <-errCh:
		return js.Undefined(), err
	case <-ctx.Done():
		return js.Undefined(), ctx.Err()
	}
}
