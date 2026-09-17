//go:build js && wasm

// Package jsutil provides shared JavaScript interop utilities for adapter packages.
package jsutil

import (
	"context"
	"fmt"
	"syscall/js"
)

// AwaitPromise blocks on a native JavaScript Promise and returns its result or error.
// If ctx expires before the Promise settles, AwaitPromise returns ctx.Err().
// Cancellation stops the wait, not the underlying operation: both callbacks stay
// valid until settlement, then release each other. A Promise that never settles
// retains its callbacks, so callers must use operations with bounded lifetimes.
func AwaitPromise(ctx context.Context, promise js.Value) (js.Value, error) {
	type result struct {
		value js.Value
		err   error
	}
	// Buffered so late settlement after cancellation cannot block the JS goroutine.
	resultCh := make(chan result, 1)

	var then, catch js.Func
	release := func() {
		then.Release()
		catch.Release()
	}
	then = js.FuncOf(func(_ js.Value, args []js.Value) any {
		defer release()
		resultCh <- result{value: args[0]}
		return js.Undefined()
	})
	catch = js.FuncOf(func(_ js.Value, args []js.Value) any {
		defer release()
		// Promise rejection reasons need not be Error objects (or even objects).
		message := js.Global().Get("String").Invoke(args[0]).String()
		resultCh <- result{value: js.Undefined(), err: fmt.Errorf("promise rejected: %s", message)}
		return js.Undefined()
	})

	// One reaction pair avoids an extra chained Promise and JS bridge call.
	// Always attach both handlers, even if ctx is already canceled, so a later
	// rejection of the already-started operation is still handled.
	promise.Call("then", then, catch)

	select {
	case r := <-resultCh:
		return r.value, r.err
	case <-ctx.Done():
		return js.Undefined(), ctx.Err()
	}
}
