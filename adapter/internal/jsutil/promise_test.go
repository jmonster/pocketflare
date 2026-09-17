//go:build js && wasm

package jsutil

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"syscall/js"
	"testing"
	"time"
)

func deferredPromise() (promise, resolve, reject js.Value) {
	executor := js.FuncOf(func(_ js.Value, args []js.Value) any {
		resolve, reject = args[0], args[1]
		return nil
	})
	defer executor.Release()
	promise = js.Global().Get("Promise").New(executor)
	return
}

func TestAwaitPromiseResolve(t *testing.T) {
	for _, value := range []js.Value{js.ValueOf(42), js.ValueOf("ok"), js.Null(), js.Undefined()} {
		got, err := AwaitPromise(context.Background(), js.Global().Get("Promise").Call("resolve", value))
		if err != nil || !got.Equal(value) {
			t.Fatalf("resolve(%v) = (%v, %v)", value, got, err)
		}
	}
}

func TestAwaitPromiseReject(t *testing.T) {
	for _, tc := range []struct {
		name   string
		reason js.Value
		want   string
	}{
		{"error", js.Global().Get("Error").New("boom"), "Error: boom"},
		{"string", js.ValueOf("no"), "no"},
		{"number", js.ValueOf(7), "7"},
		{"null", js.Null(), "null"},
		{"undefined", js.Undefined(), "undefined"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := AwaitPromise(context.Background(), js.Global().Get("Promise").Call("reject", tc.reason))
			if !got.IsUndefined() || err == nil || err.Error() != "promise rejected: "+tc.want {
				t.Fatalf("reject = (%v, %v), want undefined and %q", got, err, tc.want)
			}
		})
	}
}

func TestAwaitPromiseAlreadyCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	promise, _, reject := deferredPromise()
	got, err := AwaitPromise(ctx, promise)
	if !got.IsUndefined() || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled = (%v, %v)", got, err)
	}
	// The operation has already started: its rejection must still be handled.
	reject.Invoke(js.Global().Get("Error").New("already canceled"))
	time.Sleep(time.Millisecond)
}

func TestAwaitPromiseLateSettlement(t *testing.T) {
	for _, reject := range []bool{false, true} {
		t.Run(fmt.Sprintf("reject=%t", reject), func(t *testing.T) {
			console := js.Global().Get("console")
			original := console.Get("error")
			var callbackErrors []string
			capture := js.FuncOf(func(_ js.Value, args []js.Value) any {
				for _, arg := range args {
					if message := arg.String(); strings.Contains(message, "released function") {
						callbackErrors = append(callbackErrors, message)
					}
				}
				return nil
			})
			console.Set("error", capture)
			defer func() {
				console.Set("error", original)
				capture.Release()
			}()

			promise, resolve, rejectPromise := deferredPromise()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			timer := time.AfterFunc(time.Millisecond, cancel)
			defer timer.Stop()
			got, err := AwaitPromise(ctx, promise)
			if !got.IsUndefined() || !errors.Is(err, context.Canceled) {
				t.Fatalf("cancel pending promise = (%v, %v)", got, err)
			}

			// Canceling the wait does not cancel D1/R2's underlying operation.
			if reject {
				rejectPromise.Invoke(js.Global().Get("Error").New("late rejection"))
			} else {
				resolve.Invoke("late result")
			}
			// Yield to the JS event loop so all native Promise reactions run.
			time.Sleep(time.Millisecond)
			if len(callbackErrors) != 0 {
				t.Fatalf("late settlement invoked released Go callbacks: %v", callbackErrors)
			}
			// A late callback must also not block the JS goroutine.
			if _, err := AwaitPromise(context.Background(), js.Global().Get("Promise").Call("resolve", "next")); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func BenchmarkAwaitPromise(b *testing.B) {
	promise := js.Global().Get("Promise").Call("resolve", 42)
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := AwaitPromise(ctx, promise); err != nil {
			b.Fatal(err)
		}
	}
}
