//go:build js && wasm

package adapter

import (
	"context"
	"syscall/js"

	"github.com/pocketbase/pocketbase/core"
	"github.com/syumai/workers/cloudflare"

	"github.com/pocketflare/pocketflare/adapter/internal/jsutil"
)

const restoreMarkerKey = "pocketflare-restore/active.json"

func writeRestoreMarker(marker *RestoreMarker) error {
	bucket := cloudflare.GetBinding("STORAGE")
	if bucket.IsUndefined() || bucket.IsNull() {
		return nil
	}

	data := markerToJSON(marker)
	ua := js.Global().Get("Uint8Array").New(len(data))
	js.CopyBytesToJS(ua, data)

	putOpts := js.Global().Get("Object").New()
	httpMeta := js.Global().Get("Object").New()
	httpMeta.Set("contentType", "application/json")
	putOpts.Set("httpMetadata", httpMeta)

	promise := bucket.Call("put", restoreMarkerKey, ua.Get("buffer"), putOpts)
	_, err := jsutil.AwaitPromise(context.Background(), promise)
	return err
}

func readRestoreMarker() (*RestoreMarker, error) {
	bucket := cloudflare.GetBinding("STORAGE")
	if bucket.IsUndefined() || bucket.IsNull() {
		return nil, nil
	}

	promise := bucket.Call("get", restoreMarkerKey)
	result, err := jsutil.AwaitPromise(context.Background(), promise)
	if err != nil {
		return nil, err
	}
	if result.IsNull() {
		return nil, nil
	}

	body := result.Get("body")
	if body.IsUndefined() || body.IsNull() {
		return nil, nil
	}

	reader := body.Call("getReader")
	var chunks []byte
	for {
		readPromise := reader.Call("read")
		chunkResult, err := jsutil.AwaitPromise(context.Background(), readPromise)
		if err != nil {
			return nil, err
		}
		if done := chunkResult.Get("done"); !done.IsUndefined() && done.Bool() {
			break
		}
		value := chunkResult.Get("value")
		if !value.IsUndefined() && !value.IsNull() {
			length := value.Get("byteLength").Int()
			if length > 0 {
				tmp := js.Global().Get("Uint8Array").New(value)
				buf := make([]byte, length)
				js.CopyBytesToGo(buf, tmp)
				chunks = append(chunks, buf...)
			}
		}
	}

	return parseMarkerJSON(chunks)
}

func deleteRestoreMarker() error {
	bucket := cloudflare.GetBinding("STORAGE")
	if bucket.IsUndefined() || bucket.IsNull() {
		return nil
	}

	promise := bucket.Call("delete", restoreMarkerKey)
	_, err := jsutil.AwaitPromise(context.Background(), promise)
	return err
}

func writeRestoreMarkerOnlyIfNew(marker *RestoreMarker) error {
	bucket := cloudflare.GetBinding("STORAGE")
	if bucket.IsUndefined() || bucket.IsNull() {
		return nil
	}

	data := markerToJSON(marker)
	ua := js.Global().Get("Uint8Array").New(len(data))
	js.CopyBytesToJS(ua, data)

	putOpts := js.Global().Get("Object").New()
	httpMeta := js.Global().Get("Object").New()
	httpMeta.Set("contentType", "application/json")
	putOpts.Set("httpMetadata", httpMeta)

	onlyIf := js.Global().Get("Object").New()
	onlyIf.Set("etagDoesNotMatch", "*")
	putOpts.Set("onlyIf", onlyIf)

	promise := bucket.Call("put", restoreMarkerKey, ua.Get("buffer"), putOpts)
	result, err := jsutil.AwaitPromise(context.Background(), promise)
	if err != nil {
		return err
	}
	// R2 put() with onlyIf returns null when the precondition (etagDoesNotMatch) fails,
	// meaning the key already exists.
	if result.IsNull() {
		return ErrRestoreMarkerExists
	}
	return nil
}

func hasStorageObjects(app core.App) bool {
	bucket := cloudflare.GetBinding("STORAGE")
	if bucket.IsUndefined() || bucket.IsNull() {
		return false
	}

	opts := js.Global().Get("Object").New()
	opts.Set("limit", 1)
	opts.Set("prefix", "storage/")

	promise := bucket.Call("list", opts)
	result, err := jsutil.AwaitPromise(context.Background(), promise)
	if err != nil {
		app.Logger().Warn("Failed to check R2 storage/ prefix", "error", err.Error())
		return false
	}

	objects := result.Get("objects")
	return objects.Length() > 0
}
